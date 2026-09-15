// Runs the WebLLM engine (model download + inference) off the main thread —
// same reasoning as py.worker.ts, but this one is a real ES module worker
// (WebWorkerMLCEngineHandler needs `import`), unlike the classic-script C/JS/
// Python workers elsewhere in src/runner/, so aiAssist.ts must instantiate it
// with `{ type: 'module' }`.
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

let handler: WebWorkerMLCEngineHandler | undefined;

self.onmessage = (msg: MessageEvent) => {
  if (!handler) {
    handler = new WebWorkerMLCEngineHandler();
  }
  handler.onmessage(msg);
};
