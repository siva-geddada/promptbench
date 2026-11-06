# PromptBench

**Automated tests for AI prompts.** Write your test cases once, then run them on every prompt or model change. You get a pass rate, a side-by-side diff, and a check that can stop a bad prompt from reaching your users.

PromptBench is a command-line tool (CLI). It runs on your machine, and works with local models through Ollama, or with any OpenAI-compatible API.

```
v1
  25% (1/4) below threshold 90%  5 model calls, 0 cached
v2
  100% (4/4) meets threshold 90%  5 model calls, 0 cached
```

## Contents

- [Why PromptBench exists](#why-promptbench-exists)
- [What it does](#what-it-does)
- [Who it's for](#who-its-for)
- [How it works](#how-it-works)
- [Install](#install)
- [Tutorial: your first eval in 10 minutes](#tutorial-your-first-eval-in-10-minutes)
- [Config reference](#config-reference)
- [Assertions](#assertions)
- [Commands](#commands)
- [Everyday workflows](#everyday-workflows)
- [Using it in CI](#using-it-in-ci)
- [How the cache works](#how-the-cache-works)
- [Writing good test cases](#writing-good-test-cases)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)
- [FAQ](#faq)
- [Development](#development)

## Why PromptBench exists

Normal code has tests. When you change a function, tests tell you whether you broke something. Most AI features have nothing like that.

A prompt is code too, because it controls how your product behaves. But it is usually changed like this:

1. A user reports one bad answer.
2. Someone edits the prompt to fix it.
3. They try two or three examples, and it looks fine.
4. They ship it.
5. A week later, a different kind of question starts getting wrong answers, and nobody knows when that started.

Step 3 is the problem. Nobody retests every important example by hand, so a fix for one case can quietly break another. **PromptBench makes step 3 automatic**, and turns "looks fine to me" into a number.

### Without PromptBench and with it

| | Without PromptBench | With PromptBench |
| --- | --- | --- |
| **Testing a change** | Try a few examples by hand | Every saved case runs automatically |
| **Knowing it improved** | An opinion: "seems better" | A number: "82% to 94%" |
| **Regressions** | Found later, often by customers | Found before release |
| **Comparing prompts** | Copy and paste between tabs | One side-by-side diff |
| **Switching models** | A risky guess | Same tests, compared directly |
| **Past bugs** | Can return unnoticed | Each one becomes a permanent test |
| **Cost of retesting** | Hours of someone's time | Seconds, and cached cases are free |
| **Team knowledge** | Lives in one person's head | Lives in a file in your repo |

### What goes wrong without testing

- **Silent regressions.** A prompt change fixes one case and breaks others, and nothing warns you.
- **Fear of changing prompts.** Teams stop improving a prompt because nobody knows what might break.
- **Model changes become risky.** A cheaper or newer model might be better, but with nothing to measure, teams stick with what they have or switch blindly.
- **Rules get broken.** If the AI must never give legal advice or mention a competitor, nothing checks that this still holds after a change.
- **Hard to explain quality.** When a manager or client asks how good the AI is, there's no answer but opinion.
- **Wasted time.** People keep retesting the same examples by hand.

## What it does

- **Test cases in YAML or JSON**, kept in your repo next to your code
- **Code assertions** for text, regex, JSON fields and length
- **Model-graded assertions** for what code can't check, such as tone
- **Side-by-side diffs** showing what was fixed, what regressed and what changed
- **A SQLite cache**, so re-runs only call the model for what changed
- **A `--ci` mode** that fails your build below a pass rate
- **Any OpenAI-compatible server:** Ollama, LM Studio, vLLM, llama.cpp or OpenAI

## Who it's for

PromptBench is for developers and teams with an AI feature that real people depend on. You need to be comfortable with a terminal and a YAML file.

| Who | Situation | How it helps |
| --- | --- | --- |
| **Support teams** | An AI sorts tickets into billing, bug or other | Shows that a new prompt still routes correctly |
| **Developers** | Changing a prompt in a live feature | The diff shows what got better and worse before release |
| **Team leads** | Deciding whether to switch to a cheaper model | Runs the same tests on both models |
| **Companies with private data** | Choosing a local model so data stays in-house | Tests local models through Ollama, with no cloud involved |
| **Compliance and legal** | The AI must never say certain things | `not-contains` and `judge` rules check it on every change |
| **Engineering teams** | Stopping bad prompts reaching customers | `--ci` fails the build when the pass rate drops |
| **Data extraction work** | AI pulls fields from invoices and forms | Checks that output is valid JSON with the right values |
| **Solo builders** | Choosing a model for a side project | Compares models on your real tasks, for free with Ollama |

### A real-world scenario

You run an online shop with an AI chatbot. Your prompt says:

> You are a shop assistant. Be polite. Returns are allowed within 30 days.

It works well for months. Then your manager says, "The replies are too long, make them shorter."

**Without PromptBench,** you edit the prompt, try two questions, and it looks fine, so you release it. Next week, customers complain: the shorter replies stopped mentioning the 30-day limit, so people are trying to return shoes after 60 days and getting angry. You changed one thing and broke another, and nobody noticed.

**With PromptBench,** you've saved real customer questions and written down what a good answer must do:

| Customer question | The answer must |
| --- | --- |
| "I want to return my shoes" | Mention **30 days** |
| "Where is my order?" | Ask for the **order number** |
| "Your product is rubbish!" | Stay **polite** |
| "Is your competitor cheaper?" | **Not** mention the competitor |
| Any question | Stay **short**, under 300 characters |

Now you edit the prompt and run one command:

```bash
promptbench diff old new
```

The diff marks the broken case as `REGRESSED` and ends with a summary:

```
3 fixed, 1 regressed, 0 changed, 16 same
```

You open the regressed case, see the reply no longer mentions 30 days, and fix the prompt. You find the problem before any customer does.

### When to use it

Use PromptBench whenever you change something in an AI feature and need to know you didn't break anything:

1. **You change a prompt.** Did anything break?
2. **You change the model,** for example to a cheaper one. Is it still good enough?
3. **A customer reports a bad answer.** Add it as a test, so it can't come back.
4. **You're building an AI feature,** and want proof that it works before launch.

You don't need it for one-off tasks in a chat app, or for small experiments where nobody relies on the answers.

## How it works

```
 promptbench.yaml
 (prompts + test cases)
        │
        ▼
 Fill in {{variables}} ──► Check the cache ──► Call the model
                                 │                   │
                                 └──── reply ◄───────┘
                                         │
                                         ▼
                            Run each assertion on the reply
                                         │
                                         ▼
                 Pass rate, diff, and an exit code for CI
```

Three terms are used throughout this guide:

- A **prompt** is the instruction you are testing. You can keep several versions, such as `v1` and `v2`.
- A **case** is one test input, plus what a good answer looks like.
- An **assertion** is one rule the output must follow. A case passes only if all its assertions pass.

## Install

You need **Node.js 24 or newer**. Check with:

```bash
node --version
```

You also need a model to test. The easiest free option is [Ollama](https://ollama.com):

```bash
ollama pull qwen3:8b
```

Any current model works. Pick one that suits your machine.

### Option 1: from npm

Use this once the package is published to npm:

```bash
npm install -g promptbench
promptbench --version
```

To run it with no install:

```bash
npx promptbench --help
```

### Option 2: from source

```bash
git clone https://github.com/siva-geddada/promptbench.git
cd promptbench
npm install
npm run build
npm install -g .
promptbench --version
```

### Option 3: without a global install

After `npm install` and `npm run build`, you can run it directly:

```bash
node dist/cli.js --help
```

## Tutorial: your first eval in 10 minutes

This walkthrough tests a support ticket classifier.

### Step 1: create a project

```bash
mkdir ticket-evals
cd ticket-evals
promptbench init
```

That creates a working sample called `promptbench.yaml`.

### Step 2: choose your model

Open `promptbench.yaml`, and set the model you pulled:

```yaml
provider:
  baseUrl: http://localhost:11434/v1
  model: qwen3:8b
  reasoningEffort: none
```

`reasoningEffort: none` makes reasoning models much faster on simple tasks.

### Step 3: run it

```bash
promptbench run
```

Each case prints `PASS`, `FAIL` or `ERROR`, followed by a summary for each prompt:

```
v2
  PASS double charge
  PASS crash report
  FAIL polite refusal
         should be at most 200 characters, got 838
```

### Step 4: compare two prompts

```bash
promptbench diff v1 v2
```

Only the cases that changed are shown, with both outputs side by side:

```
FIXED crash report
v1: FAIL                                         | v2: PASS
bug                                              | {"category": "bug"}

v1 0% -> v2 50%
2 fixed, 0 regressed, 2 changed, 0 same
```

| Label | Meaning |
| --- | --- |
| `FIXED` | Failed before, passes now |
| `REGRESSED` | Passed before, fails now |
| `CHANGED` | Same result, but different output |
| `SAME` | Identical output, not shown |

### Step 5: add your own case

Add a real example under `cases:`:

```yaml
  - name: refund request
    vars:
      message: I want my money back for last month.
    assert:
      - type: json-field
        path: category
        equals: billing
```

Run again. Only the new case calls the model, and everything else comes from the cache.

### Step 6: use it as a gate

```bash
promptbench run --prompt v2 --ci
echo $?
```

In PowerShell, use `echo $LASTEXITCODE`. You'll see `0` if the pass rate meets your `threshold`, or `1` if it doesn't.

## Config reference

PromptBench reads `promptbench.yaml` by default. JSON works too. Here is a full example:

```yaml
provider:
  baseUrl: http://localhost:11434/v1
  model: qwen3:8b
  temperature: 0
  reasoningEffort: none

# Optional: grade with a different model
judge:
  baseUrl: http://localhost:11434/v1
  model: qwen3:14b

threshold: 0.9
concurrency: 2

prompts:
  # Plain text is sent as a user message
  v1: "Classify this message as billing, bug or other: {{message}}"

  # Separate system and user messages
  v2:
    system: 'Reply with only JSON: {"category": "billing" | "bug" | "other"}'
    user: "{{message}}"

  # Stored in a file, relative to this config
  v3:
    file: prompts/v3.txt

cases:
  - name: double charge
    vars:
      message: I was charged twice this month.
    assert:
      - type: is-json
      - type: json-field
        path: category
        equals: billing
```

### Top-level options

| Option | Default | Meaning |
| --- | --- | --- |
| `provider` | Required | The model being tested |
| `judge` | Same as `provider` | The model that grades `judge` assertions |
| `prompts` | Required | Prompt versions by name |
| `cases` | Required | A list of cases, or a path such as `cases.json` |
| `threshold` | `1` | Pass rate needed under `--ci`, from 0 to 1 |
| `concurrency` | `2` | Cases to run at once |

Case names must be unique, and each case needs at least one assertion. Mistyped keys are rejected, so `promps:` gives you an error rather than being ignored.

### Provider options

| Option | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `http://localhost:11434/v1` | Any OpenAI-compatible API |
| `model` | Required | Model name |
| `temperature` | `0` | Sampling temperature |
| `maxTokens` | Server default | Reply length limit |
| `reasoningEffort` | Server default | Sent as `reasoning_effort` |
| `timeoutMs` | `120000` | Time limit per call |
| `apiKeyEnv` | None | The name of an environment variable holding the key |

### Connecting to other servers

| Server | `baseUrl` |
| --- | --- |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp | `http://localhost:8080/v1` |
| vLLM | `http://localhost:8000/v1` |
| OpenAI | `https://api.openai.com/v1` |

For a hosted API, keep the key out of your config:

```yaml
provider:
  baseUrl: https://api.openai.com/v1
  model: your-model-name
  apiKeyEnv: OPENAI_API_KEY
```

Then set the variable before you run:

```bash
export OPENAI_API_KEY=your-key       # macOS and Linux
$env:OPENAI_API_KEY = "your-key"     # Windows PowerShell
```

Hosted models charge per call, and your prompts and test data are sent to that provider.

### Variables

`{{name}}` in a prompt is replaced with that case's `vars`. A missing variable stops the run with an error, so a typo can never reach the model.

### Keeping cases in a separate file

For large test sets, set `cases: cases.json` in your config:

```json
[
  {
    "name": "double charge",
    "vars": { "message": "I was charged twice." },
    "assert": [
      { "type": "json-field", "path": "category", "equals": "billing" }
    ]
  }
]
```

## Assertions

| Type | Options | Passes when |
| --- | --- | --- |
| `contains` | `value`, `ignoreCase` | The output includes the text |
| `not-contains` | `value`, `ignoreCase` | The output doesn't include the text |
| `equals` | `value`, `ignoreCase` | The trimmed output matches exactly |
| `regex` | `value`, `flags` | The pattern matches |
| `is-json` | | The whole output is valid JSON |
| `json-field` | `path`, `equals` | The field exists, and equals the value if given |
| `max-chars` | `value` | The output is this long or shorter |
| `min-chars` | `value` | The output is this long or longer |
| `judge` | `rubric` | A model decides the output meets the rubric |

### Examples

```yaml
assert:
  # Must mention the refund policy, in any case
  - type: contains
    value: refund policy
    ignoreCase: true

  # Must never mention a competitor
  - type: not-contains
    value: CompetitorName
    ignoreCase: true

  # Must be exactly one word
  - type: regex
    value: '^(yes|no)$'
    flags: i

  # Must be valid JSON
  - type: is-json

  # A nested field must exist
  - type: json-field
    path: customer.email

  # An array item must have this value
  - type: json-field
    path: items.0.sku
    equals: ABC-123

  # Must be short
  - type: max-chars
    value: 500

  # Quality that code can't check
  - type: judge
    rubric: The reply is polite and doesn't blame the customer.
```

### Choosing between code and `judge`

Prefer code assertions. They're free, instant and give the same result every time. Use `judge` only for what code can't measure, such as tone or helpfulness.

Treat `judge` as a helpful opinion. It's an AI grading an AI, so use the strongest model you can as the judge, and spot-check its verdicts by hand. A verdict PromptBench can't read always counts as a failure, never a pass.

## Commands

```
promptbench init                 Create a sample promptbench.yaml
promptbench run                  Run every prompt against every case
promptbench diff <a> <b>         Compare two prompts side by side
```

| Option | Meaning |
| --- | --- |
| `-c, --config <file>` | Config file, `promptbench.yaml` by default |
| `-p, --prompt <name>` | Run only this prompt |
| `--ci` | Exit `1` below the threshold, or on any regression in `diff` |
| `--threshold <0-1>` | Override the threshold |
| `--no-cache` | Call the model again for everything |
| `--json <file>` | Write full results to a file |
| `-v, --version` | Show the version |
| `-h, --help` | Show help |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | The eval ran and failed, under `--ci` |
| `2` | The eval couldn't run, for example a bad config or an unreachable model |

Without `--ci`, `run` and `diff` exit `0` even when cases fail, because you are exploring. Config and usage errors always exit `2`.

## Everyday workflows

### Improving a prompt

1. Copy your current prompt to a new name, such as `v3`.
2. Make your change.
3. Run `promptbench diff v2 v3`.
4. Check every `REGRESSED` case.
5. Keep the new version only if it's a real improvement.

### Comparing two models

Make a config for each model, with the same prompts and cases:

```bash
promptbench run -c model-a.yaml --json a.json
promptbench run -c model-b.yaml --json b.json
```

Compare the pass rates, then the JSON files for detail. Since `diff` compares prompts, this is the way to compare models.

### Turning a bug report into a test

When a user reports a bad answer:

1. Add their message as a new case that fails.
2. Fix the prompt until it passes.
3. Keep the case forever.

Your test set becomes a record of everything that has gone wrong, and it stops those mistakes from returning.

### Saving results

```bash
promptbench run --json results.json
```

The file holds every output and assertion result, ready for a report or another tool.

## Using it in CI

Run PromptBench on every pull request, so a bad prompt can't merge unnoticed:

```bash
promptbench run --prompt v2 --ci
```

The difference between exit codes matters here: `1` means your prompt got worse, and `2` means nothing was measured.

Here is a starting point for GitHub Actions. It needs a model that CI can reach, so it uses a hosted API with its key stored as a repository secret:

```yaml
name: prompt-evals
on: [pull_request]

jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install -g promptbench
      - run: promptbench run --prompt v2 --ci
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

To stay fully local, run the job on your own machine with a self-hosted runner and Ollama.

## How the cache works

Replies are saved in `.promptbench/cache.sqlite`, next to your config. The cache key covers the model, its settings and the exact messages, so changing any of those calls the model again.

- A second run of unchanged cases makes no model calls. In testing, a 4.5 minute run took under a second the second time.
- Failed calls and empty replies are never cached.
- `temperature` above 0 means replies can differ, but a cached run replays the first one. Use `--no-cache` to measure that variation.
- Add `.promptbench` to your `.gitignore`.
- To clear the cache, delete the `.promptbench` folder.

## Writing good test cases

- **Use real examples.** Real user messages find problems that invented ones miss.
- **Start small.** 20 good cases beat 200 weak ones. Grow the set over time.
- **Include edge cases:** empty input, very long input, other languages, angry users and attempts to trick the AI.
- **Test what must not happen,** as well as what should.
- **Name cases clearly.** `refund after 30 days` tells you what broke, and `test 7` doesn't.
- **Set `temperature: 0`** while testing, so results are more stable.
- **Check failures by hand.** Sometimes the test is wrong rather than the prompt.
- **Set a realistic threshold.** 100% is rarely practical with AI output, so 90% is a common start.

## Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| `promptbench` isn't found | Not installed globally | Reinstall, or use `node dist/cli.js` |
| Install or start fails | Node.js is too old | Install Node.js 24 or newer |
| `Could not reach ...` | The model server isn't running | Start Ollama, and check `baseUrl` |
| `returned 404` | Wrong model name | Run `ollama list` and correct `model` |
| `returned an empty reply` | Seen with reasoning models | Add `reasoningEffort: none`, or use a larger model |
| Very slow runs | Hidden reasoning | Add `reasoningEffort: none`. In testing, 4.5 minutes became 12 seconds |
| `is-json` fails, but output looks right | Markdown code fences around the JSON | Tell the prompt not to use them. `JSON.parse` would fail in your app too |
| `unreadable verdict` | The judge model is too weak | Use a stronger model in `judge:` |
| Results don't change | The reply is cached | Change the input, or use `--no-cache` |
| `Environment variable ... is not set` | `apiKeyEnv` points to an unset variable | Set it in the same terminal |

## Limits

- **A high score isn't proof.** It shows that your cases pass, and nothing about the ones you didn't write.
- **It's a developer tool.** There's no web interface yet, so you work in a terminal and a YAML file.
- **`judge` can be wrong,** especially with small models.
- **It tests single replies.** Multi-turn chats and agents that use tools aren't covered.
- **It's one provider protocol.** Servers must speak the OpenAI-compatible chat API.

## FAQ

**Is this a website?**
No. It's a command-line tool that you run in a terminal, on your machine or in CI.

**Why npm and not an .exe file?**
PromptBench is used by developers, who already have Node.js, and it runs in CI, where `npm install` is the normal way to add a tool. An .exe would need a separate build for each operating system, and would be far larger than this package of under 20 KB. Without a paid code signing certificate, Windows would also show a security warning.

**Does it cost anything?**
PromptBench is free. With a local model like Ollama, running it is free too. Hosted APIs charge for what you use.

**Does my data leave my machine?**
Not with a local model. PromptBench only talks to the `baseUrl` you set, so with a hosted API your prompts and test data go to that provider.

**Where do API keys go?**
In an environment variable. The config only holds the variable's name, and keys aren't stored in the cache.

**Can I test agents or chat conversations?**
Not yet. It tests one reply at a time.

## Development

```bash
git clone https://github.com/siva-geddada/promptbench.git
cd promptbench
npm install
```

| Script | What it does |
| --- | --- |
| `npm test` | Runs the unit tests |
| `npm run typecheck` | Checks types |
| `npm run build` | Compiles TypeScript to `dist/` |

| File | Purpose |
| --- | --- |
| `src/cli.ts` | Commands, options and exit codes |
| `src/config.ts` | Reads and validates config files |
| `src/provider.ts` | Talks to the model server |
| `src/runner.ts` | Runs cases, templates and the judge |
| `src/assertions.ts` | All assertion types |
| `src/cache.ts` | The SQLite cache |
| `src/report.ts` | Terminal output and diffs |
| `src/init.ts` | The sample config |

### Publishing a new version to npm

```bash
npm login
npm test
npm version patch
npm publish
```

`npm publish` builds the package automatically. Use `npm pack --dry-run` first to see exactly what will be included.

## License

MIT. See [LICENSE](LICENSE).
