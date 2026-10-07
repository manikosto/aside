# aside

Ask about your Claude Code session on the side.

```text
/aside                         open the panel
/aside why did you pick zod?   ask right away
```

- **Answers from the whole conversation**: what changed, why a choice was made, where things stand, what is risky.
- **Adds nothing to it**: the main conversation never sees the question or the answer, and its context does not grow.
- **Quick and cheap**: the answer reuses the conversation from the prompt cache; each answer shows how much came from the cache.
- **Follow-ups work**: the last few side questions go along, so "and the second one?" makes sense.
- **Quick questions**: What changed? · Where are we? · Risks? · Explain last step.
- **→ prompt** puts an answer into the prompt, when you want Claude to act on it; **⧉ copy** copies it.

## How it works

`$.model.fork` sends the main thread's last request again, with your question after it and every tool denied. The prefix comes from the prompt cache; only the question and the answer are new.

## Install

```sh
claude plugin marketplace add manikosto/aside
claude plugin install aside@aside
```

Needs Claude Code 2.1.289 or later. Pin it under the prompt with `/dock add aside` if you use [dock](https://github.com/manikosto/dock).

## License

MIT
