// The hooks runtime has the ES2025 base64 methods on Uint8Array; the engine's
// tsconfig lib (es2023) does not declare them. cells.ts guards the call.
interface Uint8Array {
  toBase64(): string
}

interface Uint8ArrayConstructor {
  fromBase64(text: string): Uint8Array
}
