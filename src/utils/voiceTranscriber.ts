import { createReadStream, promises as fs } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import path from "path";
import OpenAI from "openai";
import { config } from "../config/config";
import { logger } from "./logger";

const SUPPORTED_EXTENSIONS = new Set([".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm"]);

export class VoiceTranscriber {
  constructor(private openai: OpenAI) {}

  async transcribeFromUrl(fileUrl: string): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), "clickup-voice-"));
    const url = new URL(fileUrl);
    const extension = path.extname(url.pathname) || ".ogg";
    const inputPath = path.join(tempDir, `input${extension}`);

    try {
      logger.info("voice_download_start", { extension });
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(inputPath, buffer);

      const audioPath = SUPPORTED_EXTENSIONS.has(extension)
        ? inputPath
        : await this.convertToMp3(inputPath, tempDir);

      logger.info("voice_transcribe_start", { audioPath });
      const result = await this.openai.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: config.openai.whisperModel,
        prompt: config.openai.whisperPrompt,
      });

      logger.info("voice_transcribe_done", { length: result.text.length });
      return result.text;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private convertToMp3(inputPath: string, tempDir: string): Promise<string> {
    const outputPath = path.join(tempDir, "audio.mp3");

    return new Promise((resolve, reject) => {
      logger.info("voice_convert_start");
      const process = spawn("ffmpeg", ["-y", "-i", inputPath, outputPath], {
        stdio: "ignore",
      });

      process.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("FFMPEG_NOT_FOUND"));
          return;
        }
        reject(error);
      });

      process.on("close", (code) => {
        if (code === 0) {
          logger.info("voice_convert_done");
          resolve(outputPath);
          return;
        }
        reject(new Error(`FFMPEG_FAILED_${code ?? "unknown"}`));
      });
    });
  }
}
