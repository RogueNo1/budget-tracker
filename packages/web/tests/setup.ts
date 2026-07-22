import 'fake-indexeddb/auto';
import { Blob, File } from 'node:buffer';

// jsdom's File/Blob don't implement arrayBuffer() in this version; Node's
// own (from node:buffer, same ones used by undici) do. The app code only
// needs File.arrayBuffer() and TextEncoder/TextDecoder, both real here.
(globalThis as unknown as { File: typeof File }).File = File;
(globalThis as unknown as { Blob: typeof Blob }).Blob = Blob;
