/**
 * Test helper that mocks `Bun.spawn`-like calls by returning a function with
 * the same shape. Each call dequeues the next `MockScript` and produces a
 * subprocess whose stdout/stderr emit the scripted chunks and whose `exited`
 * promise resolves to the scripted exit code.
 *
 * Captures cmd args and stdin writes for assertion in tests.
 */

export interface MockScript {
  /** Exit code the subprocess.exited promise resolves to. */
  exitCode: number
  /** Each entry is emitted as a separate stdout chunk. Useful for testing
   *  streaming behavior — put one stream-json line per chunk. */
  stdoutChunks: string[]
  /** Same for stderr. Defaults to empty. */
  stderrChunks?: string[]
  /** Optional delay (ms) between successive chunks. Defaults to 0. */
  chunkDelayMs?: number
}

export interface SpawnCall {
  cmd: string[]
  stdinBuffer: string
  killed: boolean
  options: unknown
}

export interface MockSpawn {
  spawn: (cmd: string[], options?: unknown) => MockSubprocess
  calls: SpawnCall[]
}

export interface MockSubprocess {
  stdin: { write(s: string): void; end(): void }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
  kill: () => void
  killed: boolean
}

export function createMockSpawn(scripts: MockScript[]): MockSpawn {
  const calls: SpawnCall[] = []
  let scriptIndex = 0

  const spawn = (cmd: string[], options?: unknown): MockSubprocess => {
    const script = scripts[scriptIndex]
    scriptIndex++
    if (!script) {
      throw new Error(
        `mockSpawn: expected ${scripts.length} call(s) but got call #${scriptIndex}; ` +
          `cmd was: ${JSON.stringify(cmd)}`,
      )
    }

    const callRecord: SpawnCall = {
      cmd: [...cmd],
      stdinBuffer: '',
      killed: false,
      options,
    }
    calls.push(callRecord)

    // Honor AbortSignal: when aborted, the subprocess.exited promise rejects
    // (matching real Bun.spawn behavior with signal). Tests check
    // callRecord.killed to confirm kill() was called.
    const signal = (options as { signal?: AbortSignal } | undefined)?.signal

    const stdin = {
      write(s: string) {
        callRecord.stdinBuffer += s
      },
      end() {
        // no-op — chunk emission already begins on construction
      },
    }

    const encoder = new TextEncoder()
    const delayMs = script.chunkDelayMs ?? 0

    const buildStream = (chunks: string[] | undefined): ReadableStream<Uint8Array> =>
      new ReadableStream({
        async start(controller) {
          for (const chunk of chunks ?? []) {
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
            controller.enqueue(encoder.encode(chunk))
          }
          controller.close()
        },
      })

    const stdout = buildStream(script.stdoutChunks)
    const stderr = buildStream(script.stderrChunks)

    let resolveExited: (code: number) => void
    let rejectExited: (err: Error) => void
    const exited = new Promise<number>((resolve, reject) => {
      resolveExited = resolve
      rejectExited = reject
    })

    const totalDelay = (script.stdoutChunks.length + (script.stderrChunks?.length ?? 0)) * delayMs
    const exitTimer = setTimeout(() => resolveExited(script.exitCode), totalDelay + 1)

    // Forward declaration so the abort handler can flip killed.
    const subprocRef: { killed: boolean } = { killed: false }

    if (signal) {
      const onAbort = () => {
        clearTimeout(exitTimer)
        callRecord.killed = true
        subprocRef.killed = true
        rejectExited(new Error('aborted'))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const subproc: MockSubprocess = {
      stdin,
      stdout,
      stderr,
      exited,
      kill: () => {
        callRecord.killed = true
        subprocRef.killed = true
      },
      get killed() {
        return subprocRef.killed
      },
      set killed(v: boolean) {
        subprocRef.killed = v
      },
    } as MockSubprocess
    return subproc
  }

  return { spawn, calls }
}
