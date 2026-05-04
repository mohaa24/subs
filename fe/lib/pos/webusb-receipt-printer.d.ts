declare const WebUSBReceiptPrinter: {
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
      listener: (event: {
        type: "usb";
        vendorId: number;
        productId: number;
        manufacturerName?: string;
        productName?: string;
        serialNumber?: string;
        language?: string | null;
        codepageMapping?: string | null;
      }) => void
    ): void;
  };
};

export default WebUSBReceiptPrinter;
