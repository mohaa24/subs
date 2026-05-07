type PosReceiptPrinterEncoder = {
  new (options?: {
    columns?: number;
    language?: string;
    codepageMapping?: string;
    feedBeforeCut?: number;
    newline?: string;
    errors?: "strict" | "relaxed";
  }): {
    initialize(): unknown;
    text(value: string): unknown;
    line(value?: string): unknown;
    newline(value?: number): unknown;
    size(width: number, height?: number): unknown;
    rule(options?: { style?: "single" | "double"; width?: number }): unknown;
    align(value: "left" | "center" | "right"): unknown;
    bold(value: boolean): unknown;
    qrcode(
      value: string,
      model?: number | { model?: number; size?: number; errorlevel?: "l" | "m" | "q" | "h" },
      size?: number,
      errorlevel?: "l" | "m" | "q" | "h"
    ): unknown;
    cut(value?: string): unknown;
    encode(): Uint8Array;
  };
};

type PosQzTrayConfig = {
  getPrinter(): string;
};

type PosQzTray = {
  websocket: {
    isActive(): boolean;
    connect(options?: { retries?: number; delay?: number }): Promise<void>;
  };
  security: {
    setCertificatePromise(
      promiseHandler: (() => Promise<string>) | { then: (onfulfilled?: (value: string) => unknown) => unknown },
      options?: { rejectOnFailure?: boolean }
    ): void;
    setSignatureAlgorithm(algorithm: "SHA1" | "SHA256" | "SHA512"): void;
    setSignaturePromise(promiseFactory: (dataToSign: string) => Promise<string>): void;
  };
  printers: {
    find(query?: string): Promise<string | string[]>;
    getDefault(): Promise<string>;
  };
  configs: {
    create(
      printer: string,
      options?: { encoding?: string; forceRaw?: boolean; altPrinting?: boolean }
    ): PosQzTrayConfig;
  };
  print(
    config: PosQzTrayConfig,
    data: Array<
      | string
      | {
          type?: "raw";
          format?: "command";
          flavor?: "plain" | "base64" | "hex";
          data: string | Uint8Array;
        }
    >
  ): Promise<void>;
};

declare global {
  interface Window {
    ReceiptPrinterEncoder?: PosReceiptPrinterEncoder;
    qz?: PosQzTray;
  }
}

export {};
