export class StdinLineReader {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #buffer = "";
  #ended = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.#reader = stream.getReader();
  }

  async readLine(): Promise<string> {
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline >= 0) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        return line;
      }

      if (this.#ended) {
        const line = this.#buffer;
        this.#buffer = "";
        return line;
      }

      const { done, value } = await this.#reader.read();
      if (done) {
        this.#ended = true;
        this.#buffer += this.#decoder.decode();
      } else {
        this.#buffer += this.#decoder.decode(value, { stream: true });
      }
    }
  }
}
