"""SPDX-FileCopyrightText: 2026 MSHost contributors
SPDX-License-Identifier: AGPL-3.0-or-later
"""
import hashlib
import json
from pathlib import Path
import shutil
from source_archive import validated_sources
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
package = json.loads((root / "package.json").read_text(encoding="utf-8"))
version = package["version"]
app = root / "out" / "MSHost Talk-win32-x64"
installer = root / "out/make/squirrel.windows/x64/MSHost.Talk-windows-x64.exe"
if not installer.is_file() or not (app / "MSHost Talk.exe").is_file():
    raise SystemExit("Build application and Squirrel installer before exporting")
files = validated_sources(root)
output = root.parents[1] / "Builds/TalkDesktop/dist" / version
output.mkdir(parents=True, exist_ok=True)
prefix = f"MSHost-Talk-{version}-windows-x64"
setup = output / f"{prefix}-setup.exe"
shutil.copy2(installer, setup)
with ZipFile(output / f"{prefix}-portable.zip", "w", ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(app.rglob("*")):
        if file.is_file():
            if file.name.endswith(" Check.exe"):
                raise SystemExit("Remove the smoke-test executable before exporting")
            archive.write(file, Path("MSHost Talk") / file.relative_to(app))
with ZipFile(output / f"MSHost-Talk-{version}-source.zip", "w", ZIP_DEFLATED, compresslevel=6) as archive:
    for name in sorted(set(files) - {""}):
        if (root / name).is_file():
            archive.write(root / name, Path("MSHost-Talk-source") / name)
(output / "README.txt").write_text(
    f"MSHost Talk {version}, Windows x64\n\n"
    "Логотип Talk: белая монограмма MT в градиентном облаке.\n"
    "Установка: запустите файл setup.exe.\n"
    "Без установки: распакуйте portable.zip целиком и запустите MSHost Talk.exe.\n"
    "Профиль в обоих случаях сохраняется в %APPDATA%\\MSHost Talk.\n"
    "Сервер по умолчанию: https://cloud.mshostcloud.org\n"
    "Вход — через браузер с существующим аккаунтом Nextcloud.\n"
    "Сборка alpha, без цифровой подписи; обновления устанавливаются вручную.\n"
    "Лицензия AGPL-3.0-or-later; исходники в source.zip.\n"
    "Оригинал: https://github.com/nextcloud/talk-desktop/tree/v2.3.4\n",
    encoding="utf-8",
)
checksums = []
for file in sorted(output.iterdir()):
    if file.is_file() and file.name != "SHA256SUMS.txt":
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        checksums.append(f"{digest}  {file.name}")
(output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="utf-8")
print(output)
print("\n".join(checksums))
