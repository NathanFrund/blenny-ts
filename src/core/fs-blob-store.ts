import type { BlobStore } from "./store.ts";

export class FsBlobStore implements BlobStore {
  constructor(private readonly baseDir: string = "./data/blobs") {}

  private filePath(prefix: string, id: string): string {
    return `${this.baseDir}/${prefix}/${id}`;
  }

  private typePath(prefix: string, id: string): string {
    return `${this.baseDir}/${prefix}/${id}.type`;
  }

  private metaDir(prefix: string): string {
    return `${this.baseDir}/${prefix}`;
  }

  async set(prefix: string, id: string, file: File): Promise<string> {
    const fpath = this.filePath(prefix, id);
    const tpath = this.typePath(prefix, id);

    await Deno.mkdir(this.metaDir(prefix), { recursive: true });

    const bytes = new Uint8Array(await file.arrayBuffer());
    await Deno.writeFile(fpath, bytes);
    await Deno.writeTextFile(tpath, file.type || "application/octet-stream");

    return `${prefix}:${id}`;
  }

  async getAsResponse(prefix: string, id: string): Promise<Response> {
    const fpath = this.filePath(prefix, id);
    const tpath = this.typePath(prefix, id);

    try {
      const [data, contentType] = await Promise.all([
        Deno.readFile(fpath),
        Deno.readTextFile(tpath).catch(() => "application/octet-stream"),
      ]);

      return new Response(data, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": data.byteLength.toString(),
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  async remove(prefix: string, id: string): Promise<void> {
    const fpath = this.filePath(prefix, id);
    const tpath = this.typePath(prefix, id);

    await Promise.allSettled([
      Deno.remove(fpath),
      Deno.remove(tpath),
    ]);
  }
}
