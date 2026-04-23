import { expect } from '../tests/fixtures';
import * as fs from 'fs';
import * as path from 'path';

export type Scene = {
  caption: string;
  file: string;
  title: string;
};

const OUTPUT = path.resolve(__dirname, '..', 'screenshots');

function output(file: string): string {
  fs.mkdirSync(OUTPUT, { recursive: true });
  return path.join(OUTPUT, file);
}

export function writeManifest(scenes: Scene[]): void {
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUTPUT, 'manifest.json'),
    JSON.stringify({ scenes }, null, 2)
  );
}

export async function polish(page: any): Promise<void> {
  await page.addStyleTag({
    content: `
      * {
        caret-color: transparent !important;
      }

      .lm-MenuBar,
      .jp-Tooltip,
      .jp-HoverBox {
        animation: none !important;
        transition: none !important;
      }
    `
  });
}

export async function captureGroup(
  page: any,
  locators: any[],
  file: string,
  options: { padding?: number; within?: any } = {}
): Promise<void> {
  const { padding = 16, within = null } = options;
  const boxes = (
    await Promise.all(
      locators.map(async locator => {
        await expect(locator).toBeVisible();
        return locator.boundingBox();
      })
    )
  ).filter(Boolean) as Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  const viewport = page.viewportSize();
  if (!boxes.length || !viewport)
    throw new Error(`Could not capture screenshot group: ${file}`);

  const frame = within ? await within.boundingBox() : null;
  const left = frame ? frame.x : 0;
  const top = frame ? frame.y : 0;
  const rightEdge = frame ? frame.x + frame.width : viewport.width;
  const bottomEdge = frame ? frame.y + frame.height : viewport.height;

  const x = Math.max(left, Math.min(...boxes.map(({ x }) => x)) - padding);
  const y = Math.max(top, Math.min(...boxes.map(({ y }) => y)) - padding);
  const right = Math.min(
    rightEdge,
    Math.max(...boxes.map(({ x, width }) => x + width)) + padding
  );
  const bottom = Math.min(
    bottomEdge,
    Math.max(...boxes.map(({ y, height }) => y + height)) + padding
  );

  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: { x, y, width: right - x, height: bottom - y },
    path: output(file)
  });
}
