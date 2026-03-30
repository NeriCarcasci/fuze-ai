import { createRun } from 'fuze-ai'

export interface EmailResult {
  messageId: string
  to: string
  subject: string
  sentAt: string
}

export const sentEmails: EmailResult[] = []

export function makeSendEmail(run: ReturnType<typeof createRun>) {
  return run.guard(
    async function sendEmail(to: unknown, subject: unknown, body: unknown): Promise<EmailResult> {
      await new Promise(r => setTimeout(r, 100))

      const result: EmailResult = {
        messageId: `msg-${Date.now()}`,
        to: to as string,
        subject: subject as string,
        sentAt: new Date().toISOString(),
      }

      sentEmails.push(result)
      return result
    },
    {
      sideEffect: true,
      maxRetries: 1,
      compensate: async (originalResult: unknown) => {
        await new Promise(r => setTimeout(r, 50))
        const email = originalResult as EmailResult
        const idx = sentEmails.findIndex(e => e.messageId === email.messageId)
        if (idx >= 0) {
          sentEmails.splice(idx, 1)
        }
      },
    },
  )
}
