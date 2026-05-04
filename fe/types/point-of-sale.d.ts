declare module "@point-of-sale/receipt-printer-encoder" {
  export interface ReceiptPrinterEncoderOptions {
    columns?: number;
    language?: string;
    codepageMapping?: string;
    feedBeforeCut?: number;
    newline?: string;
    errors?: "strict" | "relaxed";
  }

  export default class ReceiptPrinterEncoder {
    constructor(options?: ReceiptPrinterEncoderOptions);
    initialize(): this;
    text(value: string): this;
    line(value?: string): this;
    newline(value?: number): this;
    rule(options?: { style?: "single" | "double"; width?: number }): this;
    align(value: "left" | "center" | "right"): this;
    bold(value: boolean): this;
    qrcode(
      value: string,
      model?: number | { model?: number; size?: number; errorlevel?: "l" | "m" | "q" | "h" },
      size?: number,
      errorlevel?: "l" | "m" | "q" | "h"
    ): this;
    cut(value?: string): this;
    encode(): Uint8Array;
  }
}

declare module "@point-of-sale/webusb-receipt-printer" {
  export interface WebUsbConnectedDevice {
    type: "usb";
    vendorId: number;
    productId: number;
    manufacturerName?: string;
    productName?: string;
    serialNumber?: string;
    language?: string | null;
    codepageMapping?: string | null;
  }

  export default class WebUSBReceiptPrinter {
    connect(): Promise<void>;
    reconnect(device: {
      vendorId?: number;
      productId?: number;
      serialNumber?: string;
    }): Promise<void>;
    disconnect(): Promise<void>;
    print(data: Uint8Array): Promise<void>;
    addEventListener(
      type: "connected" | "disconnected" | "data",
      listener: (event: WebUsbConnectedDevice) => void
    ): void;
  }
}

declare module "@point-of-sale/webserial-receipt-printer" {
  export interface WebSerialConnectedDevice {
    type: "serial";
    vendorId: number | null;
    productId: number | null;
    language?: string | null;
    codepageMapping?: string | null;
  }

  export default class WebSerialReceiptPrinter {
    constructor(options?: {
      baudRate?: number;
      bufferSize?: number;
      dataBits?: 7 | 8;
      flowControl?: "none" | "hardware";
      parity?: "none" | "even" | "odd";
      stopBits?: 1 | 2;
    });
    connect(): Promise<void>;
    reconnect(device: { vendorId?: number | null; productId?: number | null }): Promise<void>;
    disconnect(): Promise<void>;
    print(data: Uint8Array): Promise<void>;
    addEventListener(
      type: "connected" | "disconnected" | "data",
      listener: (event: WebSerialConnectedDevice) => void
    ): void;
  }
}
