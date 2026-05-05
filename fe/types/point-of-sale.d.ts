type PosConnectedUsbDevice = {
  type: "usb";
  vendorId: number;
  productId: number;
  manufacturerName?: string;
  productName?: string;
  serialNumber?: string;
  language?: string | null;
  codepageMapping?: string | null;
};

type PosConnectedSerialDevice = {
  type: "serial";
  vendorId: number | null;
  productId: number | null;
  language?: string | null;
  codepageMapping?: string | null;
};

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

type PosWebUsbReceiptPrinter = {
  new (): {
    connect(): Promise<void>;
    reconnect(device: {
      vendorId?: number | null;
      productId?: number | null;
      serialNumber?: string;
    }): Promise<void>;
    disconnect(): Promise<void>;
    print(data: Uint8Array): Promise<void>;
    addEventListener(
      type: "connected" | "disconnected" | "data",
      listener: (event: PosConnectedUsbDevice) => void
    ): void;
  };
};

type PosWebSerialReceiptPrinter = {
  new (options?: {
    baudRate?: number;
    bufferSize?: number;
    dataBits?: 7 | 8;
    flowControl?: "none" | "hardware";
    parity?: "none" | "even" | "odd";
    stopBits?: 1 | 2;
  }): {
    connect(): Promise<void>;
    reconnect(device: { vendorId?: number | null; productId?: number | null }): Promise<void>;
    disconnect(): Promise<void>;
    print(data: Uint8Array): Promise<void>;
    addEventListener(
      type: "connected" | "disconnected" | "data",
      listener: (event: PosConnectedSerialDevice) => void
    ): void;
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
    WebUSBReceiptPrinter?: PosWebUsbReceiptPrinter;
    WebSerialReceiptPrinter?: PosWebSerialReceiptPrinter;
    qz?: PosQzTray;
  }
}

export {};
