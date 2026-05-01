import { describe, expect, it } from 'vitest'
import {
  ChildProcessSidecarTransport,
  PresidioSidecarEngine,
} from '../src/index.js'

const liveEnabled = process.env['CI_PII_PRESIDIO'] === '1'

const PYTHON_BIN = process.env['CI_PII_PRESIDIO_PYTHON'] ?? 'python3'

// Minimal sidecar script that wraps presidio_analyzer's AnalyzerEngine in a
// newline-delimited JSON-RPC loop matching the JsonRpcRequest/Response shape.
// The user must have `presidio-analyzer` (and a spaCy model, e.g. en_core_web_lg)
// installed in the Python environment that PYTHON_BIN points at. If anything
// is missing the test fails with a clear message — that is the contract.
const SIDECAR_SCRIPT = `
import json, sys
from presidio_analyzer import AnalyzerEngine

analyzer = AnalyzerEngine()

def kind_for(entity_type):
    mapping = {
        "EMAIL_ADDRESS": "email",
        "US_SSN": "us-ssn",
        "PHONE_NUMBER": "phone",
        "IP_ADDRESS": "ipv4",
        "CREDIT_CARD": "creditCard",
        "PERSON": "person",
        "LOCATION": "location",
        "ORGANIZATION": "organization",
    }
    return mapping.get(entity_type, "person")

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    text = req.get("params", {}).get("value", "")
    try:
        results = analyzer.analyze(text=str(text), language="en")
        bucket = {}
        for r in results:
            k = kind_for(r.entity_type)
            entry = bucket.setdefault(k, {"kind": k, "count": 0, "fields": []})
            entry["count"] += 1
            entry["fields"].append(str(text)[r.start:r.end])
        confidence = max((r.score for r in results), default=0.0)
        resp = {
            "jsonrpc": "2.0",
            "id": req.get("id"),
            "result": {
                "value": text,
                "findings": list(bucket.values()),
                "confidence": confidence,
            },
        }
    except Exception as exc:
        resp = {
            "jsonrpc": "2.0",
            "id": req.get("id"),
            "error": {"code": -32000, "message": str(exc)},
        }
    sys.stdout.write(json.dumps(resp) + "\\n")
    sys.stdout.flush()
`

describe.skipIf(!liveEnabled)(
  'Presidio sidecar — live (gated by CI_PII_PRESIDIO=1)',
  () => {
    it('detects email and us-ssn in a known-PII string', async () => {
      const transport = new ChildProcessSidecarTransport({
        command: PYTHON_BIN,
        args: ['-c', SIDECAR_SCRIPT],
      })
      const engine = new PresidioSidecarEngine({ transport, timeoutMs: 30_000 })
      try {
        const out = await engine.redact(
          'my email is alice@example.com and SSN is 123-45-6789',
        )
        const kinds = out.findings.map((f) => f.kind)
        expect(kinds).toContain('email')
        expect(kinds).toContain('us-ssn')
        expect(out.confidence).toBeGreaterThan(0.5)
      } finally {
        await engine.close()
      }
    }, 60_000)
  },
)
