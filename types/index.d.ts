// One side question and, once it lands, its answer.
export type AsideEntry = {
  id: number
  q: string
  a?: string
  error?: string
  at: number
  ms?: number
  // tokens: read from the prompt cache, sent fresh, written by the answer
  cached?: number
  fresh?: number
  out?: number
}

declare module 'claude-code' {
  interface PluginState {
    aside: {
      thread: AsideEntry[]
      asking: boolean
    }
  }
}
