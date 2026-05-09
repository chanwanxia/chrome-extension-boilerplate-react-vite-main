import { streamFileToZip } from '@extension/dev-utils';
import fg from 'fast-glob';
import { unzipSync, Zip } from 'fflate';
import { rimraf } from 'rimraf';
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const zipAndDeleteModuleTest = async (moduleName, archivePath, testsPath) => {
  const moduleTestName = `page-${moduleName}.test.js`;
  const moduleTestsPath = resolve(testsPath, moduleTestName);
  await zipFolder(testsPath, resolve(archivePath, `${moduleName}.test.zip`), [moduleTestName]);
  void rimraf([moduleTestsPath]);
};
export const zipAndDeleteModule = async (moduleName, pagesPath, archivePath, testsPath) => {
  const modulePath = resolve(pagesPath, moduleName);
  await zipFolder(resolve(pagesPath, moduleName), resolve(archivePath, `${moduleName}.zip`));
  void rimraf([modulePath]);
  if (testsPath && existsSync(testsPath)) {
    await zipAndDeleteModuleTest(moduleName, archivePath, testsPath);
  }
};
export const zipAndDeleteTests = async (testsPath, archivePath) => {
  await zipFolder(testsPath, resolve(archivePath, `tests.zip`));
  void rimraf(testsPath);
};
export const unZipAndDeleteModule = (zipFilePath, destPath) => {
  const unzipped = unzipSync(readFileSync(zipFilePath));
  mkdirSync(destPath, { recursive: true });
  for (const [filePath, fileData] of Object.entries(unzipped)) {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, fileData);
  }
  unlinkSync(zipFilePath);
};
export const zipFolder = async (folderPath, out, filesToInclude) => {
  const fileList = await fg(
    ['!node_modules', '!dist', '!**/*/node_modules', '!**/*/dist'].concat(
      filesToInclude?.length ? filesToInclude : ['**/*'],
    ),
    {
      cwd: folderPath,
      onlyFiles: true,
    },
  );
  const output = createWriteStream(out);
  return new Promise((resolvePromise, rejectPromise) => {
    const zip = new Zip((err, data, final) => {
      if (err) {
        rejectPromise(err);
      } else {
        output.write(data);
        if (final) {
          output.end();
          resolvePromise();
          console.log(`Archive created at: ${out} for recovery`);
        }
      }
    });
    for (const file of fileList) {
      const absPath = resolve(folderPath, file);
      console.log(`Archiving file: ${absPath}`);
      streamFileToZip(
        absPath,
        absPath,
        zip,
        () => {
          output.end();
          rejectPromise(new Error('Aborted'));
        },
        rejectPromise,
      );
    }
    zip.end();
  });
};
