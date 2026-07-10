import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";

// ── mock environment detection ────────────────────────────────────────────────
vi.mock("$lib/utils/environment", () => ({
  isTauri: vi.fn(() => false),
}));

// ── mock Tauri plugins ────────────────────────────────────────────────────────
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
  writeFile: vi.fn(),
  readTextFile: vi.fn(),
}));

import * as env from "$lib/utils/environment";
import * as dialog from "@tauri-apps/plugin-dialog";
import * as fs from "@tauri-apps/plugin-fs";
import { saveFile, pickFile } from "./file-bridge";

function setTauri(value: boolean) {
  vi.mocked(env.isTauri).mockReturnValue(value);
}

// jsdom does not implement URL.createObjectURL / revokeObjectURL
beforeAll(() => {
  if (typeof URL.createObjectURL === "undefined") {
    URL.createObjectURL = vi.fn(() => "blob:fake-url");
  }
  if (typeof URL.revokeObjectURL === "undefined") {
    URL.revokeObjectURL = vi.fn();
  }
});

describe("saveFile — browser mode", () => {
  let createdAnchor: HTMLAnchorElement | null = null;
  const fakeUrl = "blob:fake-url";

  beforeEach(() => {
    setTauri(false);
    vi.mocked(URL.createObjectURL).mockReturnValue(fakeUrl);
    vi.mocked(URL.revokeObjectURL).mockReset();

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "a") {
        createdAnchor = el as HTMLAnchorElement;
        vi.spyOn(el, "click").mockImplementation(() => {});
      }
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    createdAnchor = null;
  });

  it("creates a download anchor with the given filename", async () => {
    await saveFile("report.csv", "col1,col2\n1,2");
    expect(createdAnchor).not.toBeNull();
    expect(createdAnchor!.download).toBe("report.csv");
    expect(createdAnchor!.href).toBe(fakeUrl);
  });

  it("triggers a click on the anchor", async () => {
    await saveFile("out.txt", "hello");
    expect(createdAnchor!.click).toHaveBeenCalledOnce();
  });

  it("revokes the object URL after clicking", async () => {
    await saveFile("out.txt", "content");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(fakeUrl);
  });

  it("accepts a Blob directly and still downloads", async () => {
    const blob = new Blob(["data"], { type: "text/csv" });
    await saveFile("data.csv", blob, "text/csv");
    expect(createdAnchor!.download).toBe("data.csv");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });
});

describe("saveFile — Tauri mode", () => {
  afterEach(() => {
    vi.mocked(dialog.save).mockReset();
    vi.mocked(fs.writeTextFile).mockReset();
    vi.mocked(fs.writeFile).mockReset();
  });

  it("calls Tauri save dialog and writeTextFile for string content", async () => {
    setTauri(true);
    vi.mocked(dialog.save).mockResolvedValue("/tmp/out.txt");
    await saveFile("out.txt", "hello world");
    expect(dialog.save).toHaveBeenCalledWith({ defaultPath: "out.txt" });
    expect(fs.writeTextFile).toHaveBeenCalledWith("/tmp/out.txt", "hello world");
  });

  it("calls writeFile for Blob content", async () => {
    setTauri(true);
    vi.mocked(dialog.save).mockResolvedValue("/tmp/img.png");
    // Provide a Blob whose arrayBuffer() resolves correctly in jsdom
    const bytes = new Uint8Array([1, 2, 3]);
    const blob = { arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer) } as unknown as Blob;
    await saveFile("img.png", blob, "image/png");
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it("does nothing when user cancels the dialog (null path)", async () => {
    setTauri(true);
    vi.mocked(dialog.save).mockResolvedValue(null);
    await saveFile("out.txt", "text");
    expect(fs.writeTextFile).not.toHaveBeenCalled();
  });
});

describe("pickFile — browser mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the selected file from an input element", async () => {
    setTauri(false);
    const fakeFile = new File(["{}"], "theme.json", { type: "application/json" });
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "input") {
        vi.spyOn(el, "click").mockImplementation(function (this: HTMLInputElement) {
          Object.defineProperty(this, "files", {
            value: { 0: fakeFile, length: 1, item: () => fakeFile },
          });
          this.onchange?.(new Event("change"));
        });
      }
      return el;
    });
    const result = await pickFile(".json");
    expect(result).toBe(fakeFile);
  });

  it("returns null when no file is selected", async () => {
    setTauri(false);
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "input") {
        vi.spyOn(el, "click").mockImplementation(function (this: HTMLInputElement) {
          Object.defineProperty(this, "files", { value: null });
          this.onchange?.(new Event("change"));
        });
      }
      return el;
    });
    const result = await pickFile();
    expect(result).toBeNull();
  });

  it("sets the accept attribute when provided", async () => {
    setTauri(false);
    let capturedInput: HTMLInputElement | null = null;
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "input") {
        capturedInput = el as HTMLInputElement;
        vi.spyOn(el, "click").mockImplementation(function (this: HTMLInputElement) {
          Object.defineProperty(this, "files", { value: null });
          this.onchange?.(new Event("change"));
        });
      }
      return el;
    });
    await pickFile(".json");
    expect(capturedInput!.accept).toBe(".json");
  });
});

describe("pickFile — Tauri mode", () => {
  afterEach(() => {
    vi.mocked(dialog.open).mockReset();
    vi.mocked(fs.readTextFile).mockReset();
  });

  it("reads the file at the selected path and returns a File", async () => {
    setTauri(true);
    vi.mocked(dialog.open).mockResolvedValue("/home/user/theme.json");
    vi.mocked(fs.readTextFile).mockResolvedValue('{"name":"My Theme"}');
    const result = await pickFile();
    expect(result).not.toBeNull();
    expect(result!.name).toBe("theme.json");
    expect(fs.readTextFile).toHaveBeenCalledWith("/home/user/theme.json");
  });

  it("returns null when user cancels the dialog", async () => {
    setTauri(true);
    vi.mocked(dialog.open).mockResolvedValue(null);
    const result = await pickFile();
    expect(result).toBeNull();
  });

  it("returns null when dialog returns an array (unexpected)", async () => {
    setTauri(true);
    vi.mocked(dialog.open).mockResolvedValue([] as unknown as null);
    const result = await pickFile();
    expect(result).toBeNull();
  });
});
