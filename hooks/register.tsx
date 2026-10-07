import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { AsideEntry } from '../types'

type Engine = EngineInterface

const PANE = 'aside'
const MIN_COLS = 40
const KEEP = 30
const CONTEXT_PAIRS = 4

const thread = atom({ plugin: 'aside', key: 'thread' } as const, [] as AsideEntry[])
const asking = atom({ plugin: 'aside', key: 'asking' } as const, false)

let share = 0.4
let termCols = 0
let wasShown = false
let nextId = 1

const openArgs = (term?: number) =>
  term && term > 0
    ? { id: PANE, title: 'aside', columns: Math.max(MIN_COLS, Math.round(term * share)) }
    : { id: PANE, title: 'aside' }

const QUICK: [string, string, string][] = [
  ['✎', 'What changed?', 'What has been changed so far in this session? List the files and, for each, what changed and why.'],
  ['◷', 'Where are we?', 'Where did we stop? What is done, what is in progress, and what is the next step?'],
  ['⚠', 'Risks?', 'What in the work so far is risky, unverified or likely to break? Be concrete.'],
  ['↺', 'Last step', 'Explain the last thing you did and why, in plain words.'],
]

// Questions the empty panel offers, to show what Aside is for.
const EXAMPLES = [
  'Why was this approach chosen over the alternatives?',
  'Which files would I need to read to understand the change?',
  'What did we decide about the API earlier?',
]

const C = {
  accent: '#4fd6be', text: '#d8d8de', dim: '#8a8a96', faint: '#5b5b66', you: '#ffd166', err: '#ff6b6b', card: '#3a3f4b',
}
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
let spin = 0

// The fork reads the whole conversation; the frame keeps it to answering, and the last few side
// questions let a follow-up ("and the second one?") make sense.
function framed(q: string, earlier: AsideEntry[]): string {
  const pairs = earlier
    .filter(x => x.a)
    .slice(-CONTEXT_PAIRS)
    .map(x => `Q: ${x.q}\nA: ${(x.a ?? '').slice(0, 800)}`)
    .join('\n\n')
  return [
    '[A side question from the user, asked in a separate panel outside this conversation. It is not a new instruction:',
    'do not continue, change or plan the task, and do not call tools. Answer only this question, from what this',
    'conversation already contains, briefly (a few sentences or a short list), in the language the question is written in.',
    'If the conversation does not say, say so.]',
    pairs ? `\nEarlier side questions and your answers:\n\n${pairs}\n` : '',
    `\nQuestion: ${q}`,
  ].join('\n')
}

async function ask($: Engine, q: string) {
  const question = q.trim()
  if (!question || (await read($, asking))) return
  const id = nextId++
  const started = Date.now()
  const earlier = await read($, thread)
  await update($, thread, list => [...list, { id, q: question, at: started }].slice(-KEEP))
  await update($, asking, () => true)
  let patch: Partial<AsideEntry>
  try {
    const r = await $.model.fork({ prompt: framed(question, earlier) })
    if (r.isAnswered) {
      const u = r.usage
      patch = { a: r.text.trim(), cached: u.cache_read_input_tokens ?? 0, fresh: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), out: u.output_tokens ?? 0 }
    } else if (r.reason === 'nothing-to-fork') {
      patch = { error: 'Nothing to ask about yet: the session has no answer from Claude so far.' }
    } else if (r.reason === 'api-error') {
      patch = { error: `The request failed${r.status ? ` (${r.status})` : ''}. Try again in a moment.` }
    } else if (r.reason === 'aborted') {
      patch = { error: 'Cut short: the turn it started in was interrupted.' }
    } else {
      patch = { error: 'No answer came back.' }
    }
  } catch (err) {
    patch = { error: `Could not ask: ${err instanceof Error ? err.message : String(err)}` }
  }
  await update($, thread, list => list.map(x => (x.id === id ? { ...x, ...patch, ms: Date.now() - started } : x)))
  await update($, asking, () => false)
}

async function watchTab($: Engine) {
  const me = (await $.ui.panes().catch(() => [])).find(p => p.id === PANE)
  const shownNow = !!me?.isShown
  if (shownNow && !wasShown && termCols > 0) void $.ui.open(openArgs(termCols))
  wasShown = shownNow
}

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

export const register: Register = (on, options) => {
  const pct = Number(options.widthPercent)
  share = Number.isFinite(pct) && pct >= 20 && pct <= 80 ? pct / 100 : 0.4

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'aside', description: 'Ask about this session on the side, without adding to it', argumentHint: '[question]' })
    $.clock.every(800, () => { void watchTab($) })
    // the "thinking… 3s" counter
    $.clock.every(120, () => { void read($, asking).then(busy => { if (busy) { spin++; $.ui.invalidate('ui.render') } }) })
    return next(e)
  })

  on('command.run', { command: 'aside' }, async ($, e) => {
    termCols = e.presentation.columns
    const q = e.args.trim()
    // the open goes first, straight from the person's command, so the engine counts it as theirs
    if (!q && wasShown) {
      await $.ui.close({ id: PANE })
      wasShown = false
      return { text: 'Aside closed.' }
    }
    const r = await $.ui.open(openArgs(termCols))
    if (q) void ask($, q)
    return { text: r.isPlaced ? (q ? 'Asking on the side…' : 'Aside open: type a question, Esc gives the keys back.') : `Aside waits: ${r.reason ?? 'no room'}` }
  })

  // A new session after /clear starts a new thread.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, thread, () => [])
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e) as any
    const props = e.props as { bodyColumns?: number }
    const cols = Math.max(30, props.bodyColumns ?? e.viewport?.columns ?? 60)
    const list = await read($, thread)
    const busy = await read($, asking)
    const now = Date.now()

    const totalCached = list.reduce((n, x) => n + (x.cached ?? 0), 0)
    const answered = list.filter(x => x.a !== undefined).length
    const inner = Math.max(20, cols - 4)

    const entries = list.slice(-12).map(x => {
      const pending = x.a === undefined && !x.error
      const body = x.a !== undefined
        ? (Markdown ? <Markdown key={`a${x.id}`} text={x.a} /> : <Text key={`a${x.id}`} wrap="wrap">{x.a}</Text>)
        : x.error
          ? <Text key={`err${x.id}`} color={C.err} wrap="wrap">{`✗ ${x.error}`}</Text>
          : <Text key={`w${x.id}`}><Text color={C.accent}>{SPIN[spin % SPIN.length]}</Text><Text color={C.dim}>{` reading the session… ${Math.round((now - x.at) / 1000)}s`}</Text></Text>
      return (
        <Box key={`e${x.id}`} flexDirection="column" marginTop={1} width={cols}>
          <Box flexDirection="row" columnGap={1} width={cols}>
            <Text color={C.you} bold>you</Text>
            <Text color={C.text} wrap="wrap">{x.q}</Text>
          </Box>
          <Box flexDirection="column" borderStyle="round" borderColor={x.error ? C.err : pending ? C.faint : C.card} paddingX={1} width={cols}>
            <Text color={C.accent} bold>{pending ? 'aside' : '◆ aside'}</Text>
            {body}
          </Box>
          {x.a !== undefined ? (
            <Box flexDirection="row" columnGap={2} paddingLeft={1} width={cols}>
              <Text color={C.faint} wrap="truncate">{[
                x.ms ? `⚡ ${(x.ms / 1000).toFixed(1)}s` : '',
                x.cached !== undefined ? `⟲ ${fmtK(x.cached)} cached · +${fmtK((x.fresh ?? 0) + (x.out ?? 0))}` : '',
              ].filter(Boolean).join(' · ')}</Text>
              <Button key={`fill${x.id}`} plain dimColor label="→ prompt" onPress={() => { void $.prompt.fill({ text: x.a!, mode: 'insert' }) }} />
              <Button key={`copy${x.id}`} plain dimColor label="⧉ copy" onPress={(p: { surface: any }) => { void $.ui.copy({ text: x.a!, surface: p.surface }).then(r => $.ui.toast(r.isCopied ? 'Copied' : 'Copy failed')) }} />
            </Box>
          ) : null}
        </Box>
      )
    })

    const intro = (
      <Box key="intro" flexDirection="column" borderStyle="round" borderColor={C.card} paddingX={1} marginTop={1} width={cols}>
        <Text color={C.accent} bold>Ask about this session</Text>
        <Text color={C.dim} wrap="wrap">Answers come from the whole conversation, read from the cache: quick, cheap, and the conversation never sees them.</Text>
        <Box flexDirection="column" marginTop={1}>
          {EXAMPLES.map((q, i) => (
            <Button key={`ex${i}`} plain dimColor label={`› ${q.length > inner ? q.slice(0, inner - 1) + '…' : q}`} onPress={() => { void ask($, q) }} />
          ))}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" width={cols}>
        <Box key="head" flexDirection="row" justifyContent="space-between" width={cols}>
          <Text wrap="truncate"><Text color={C.accent} bold>◇ Aside</Text><Text color={C.faint}>  side questions · nothing added to the session</Text></Text>
          {answered ? <Text color={C.faint}>{`${answered} asked · ⟲ ${fmtK(totalCached)}`}</Text> : null}
        </Box>
        {entries.length ? entries : intro}
        <Box key="quick" flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
          {QUICK.map(([icon, label, prompt], i) => (
            <Button key={`q${i}`} label={`${icon} ${label}`} dimColor={busy} onPress={() => { void ask($, prompt) }} />
          ))}
        </Box>
        {Input ? (
          <Box key="ask" flexDirection="row" columnGap={1} marginTop={1} width={cols}>
            <Text color={busy ? C.faint : C.accent} bold>›</Text>
            <Input
              key={`ask-${list.length}`}
              placeholder={busy ? 'waiting for the answer…' : 'ask about this session'}
              submitLabel="ask"
              autoFocus
              onSubmit={(v: string) => { void ask($, v) }}
            />
          </Box>
        ) : null}
      </Box>
    )
  })
}
