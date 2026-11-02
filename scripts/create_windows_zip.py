import os
import sys
import zipfile


source, target, root_name = sys.argv[1:4]
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for current, directories, files in os.walk(source):
        directories.sort()
        files.sort()
        for file_name in files:
            full_path = os.path.join(current, file_name)
            relative = os.path.relpath(full_path, source)
            archive.write(full_path, os.path.join(root_name, relative).replace(os.sep, "/"))
