import os
import sys
import tarfile


stage, archive, folder_name = sys.argv[1:4]


def linux_metadata(info):
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mode = 0o755 if info.isdir() or info.name.endswith(".sh") else 0o644
    return info


with tarfile.open(archive, "w:gz", format=tarfile.PAX_FORMAT) as output:
    output.add(stage, arcname=folder_name, recursive=True, filter=linux_metadata)
