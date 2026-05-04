declare const WebSerialReceiptPrinter: {
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
      listener: (event: {
        type: "serial";
        vendorId: number | null;
        productId: number | null;
        language?: string | null;
        codepageMapping?: string | null;
      }) => void
    ): void;
  };
};

export default WebSerialReceiptPrinter;
