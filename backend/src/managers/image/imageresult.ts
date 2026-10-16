export interface ImageResult {
  image: Buffer;
  filetype: string;
  /**
   * Pixel size of `image`, when the producer knows it.
   *
   * Absent for results that were never decoded (an SVG master is stored as the
   * uploaded text), which callers must treat as "unknown" rather than as zero.
   */
  width?: number;
  height?: number;
}
