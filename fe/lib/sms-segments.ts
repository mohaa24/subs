export const MAX_SMS_SEGMENTS = 4;

export function smsSegmentInfo(message: string) {
  const encoding = /^[\x00-\x7F]*$/.test(message) ? "plain" as const : "unicode" as const;
  const characters = message.length;
  const singleLimit = encoding === "unicode" ? 70 : 155;
  const multipartLimit = encoding === "unicode" ? 67 : 155;
  const segments = characters === 0
    ? 0
    : characters <= singleLimit
      ? 1
      : Math.ceil(characters / multipartLimit);
  const currentCapacity = segments <= 1 ? singleLimit : segments * multipartLimit;
  return {
    encoding,
    characters,
    segments,
    perSegmentLimit: segments <= 1 ? singleLimit : multipartLimit,
    remainingInSegment: Math.max(0, currentCapacity - characters),
    maximumCharacters: MAX_SMS_SEGMENTS * multipartLimit,
  };
}
