import { load as loadYaml, YAMLException } from 'js-yaml'
import { PolicyLoadError, type ResourcePolicy, type Rule } from './types.js'

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const validateRule = (raw: unknown, idx: number): Rule => {
  if (!isPlainObject(raw)) {
    throw new PolicyLoadError(`rules[${idx}] is not an object`)
  }
  const { actions, effect, condition, id } = raw
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new PolicyLoadError(`rules[${idx}].actions must be a non-empty array`)
  }
  for (const a of actions) {
    if (typeof a !== 'string') {
      throw new PolicyLoadError(`rules[${idx}].actions must be strings`)
    }
  }
  if (typeof effect !== 'string') {
    throw new PolicyLoadError(`rules[${idx}].effect must be a string`)
  }
  let parsedCondition: Rule['condition']
  if (condition !== undefined) {
    if (!isPlainObject(condition) || !isPlainObject(condition['match'])) {
      throw new PolicyLoadError(`rules[${idx}].condition must have a 'match' object`)
    }
    const expr = condition['match']['expr']
    if (typeof expr !== 'string') {
      throw new PolicyLoadError(`rules[${idx}].condition.match.expr must be a string`)
    }
    parsedCondition = { match: { expr } }
  }
  const out: Rule = {
    actions: actions as readonly string[],
    effect: effect as Rule['effect'],
    ...(id === undefined ? {} : { id: String(id) }),
    ...(parsedCondition === undefined ? {} : { condition: parsedCondition }),
  }
  return out
}

export const parsePolicy = (yamlText: string): ResourcePolicy => {
  let doc: unknown
  try {
    doc = loadYaml(yamlText)
  } catch (err) {
    if (err instanceof YAMLException) {
      throw new PolicyLoadError(`malformed YAML: ${err.message}`)
    }
    throw new PolicyLoadError(`malformed YAML: ${(err as Error).message}`)
  }

  if (!isPlainObject(doc)) {
    throw new PolicyLoadError('policy document must be a YAML mapping')
  }

  const apiVersion = doc['apiVersion']
  if (typeof apiVersion !== 'string' || apiVersion.length === 0) {
    throw new PolicyLoadError("missing required field 'apiVersion'")
  }

  const rp = doc['resourcePolicy']
  if (!isPlainObject(rp)) {
    throw new PolicyLoadError("missing required field 'resourcePolicy'")
  }

  const resource = rp['resource']
  if (typeof resource !== 'string' || resource.length === 0) {
    throw new PolicyLoadError("missing required field 'resourcePolicy.resource'")
  }

  const rawRules = rp['rules']
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    throw new PolicyLoadError("'resourcePolicy.rules' must be a non-empty array")
  }

  const rules = rawRules.map((r, i) => validateRule(r, i))

  const version = rp['version']
  return {
    apiVersion,
    resourcePolicy: {
      resource,
      ...(typeof version === 'string' ? { version } : {}),
      rules,
    },
  }
}
