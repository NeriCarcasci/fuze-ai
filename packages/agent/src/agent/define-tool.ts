import type {
  PublicTool,
  PersonalTool,
  SpecialCategoryTool,
} from '../types/tool.js'

export const defineTool = {
  public: <TIn, TOut, TDeps = unknown>(
    spec: Omit<PublicTool<TIn, TOut, TDeps>, 'dataClassification'>,
  ): PublicTool<TIn, TOut, TDeps> => ({ ...spec, dataClassification: 'public' }),

  personal: <TIn, TOut, TDeps = unknown>(
    spec: Omit<PersonalTool<TIn, TOut, TDeps>, 'dataClassification'> & {
      readonly dataClassification?: 'personal' | 'business'
    },
  ): PersonalTool<TIn, TOut, TDeps> => ({
    ...spec,
    dataClassification: spec.dataClassification ?? 'personal',
  }),

  business: <TIn, TOut, TDeps = unknown>(
    spec: Omit<PersonalTool<TIn, TOut, TDeps>, 'dataClassification'>,
  ): PersonalTool<TIn, TOut, TDeps> => ({ ...spec, dataClassification: 'business' }),

  specialCategory: <TIn, TOut, TDeps = unknown>(
    spec: Omit<SpecialCategoryTool<TIn, TOut, TDeps>, 'dataClassification' | 'residencyRequired'> & {
      readonly residencyRequired?: 'eu'
    },
  ): SpecialCategoryTool<TIn, TOut, TDeps> => ({
    ...spec,
    dataClassification: 'special-category',
    residencyRequired: 'eu',
  }),
}
