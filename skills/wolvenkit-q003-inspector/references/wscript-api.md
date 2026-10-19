# WolvenKit WScript API notes

WolvenKit stores script files in `%APPDATA%\REDModding\WolvenKit\WScript`. The application offers a Script Manager for creating, editing, and running WScript files. WScript uses JavaScript and WolvenKit's internal API.

## q003 report script

The bundled `scripts/q003_wolvenkit_readonly_report.wscript` reads the q003 `.questphase` and `.scene` resources from mounted archives using `wkit.GetFileFromArchive(path, OpenAs.Json)`. It emits a single JSON marker line to WolvenKit's app log. It does not call a save, export, or packaging API. The local Codex MCP server reads that marker through `read_q003_report`.

Quest and scene graph connections use handle references; the report maps serialized source/destination socket handles back to graph nodes. It treats output sockets on the q003_03_deal `questSceneNodeDefinition` in q003_royce_deal.questphase as exits and follows those phase-graph wires to fact write nodes. Other cases remain unresolved for manual inspection.

## Common app API functions

- wkit.GetProjectFiles(folderType): enumerate files from the project archive or Raw folder. The documented folderType values are "archive" and "raw".
- wkit.GetFileFromProject(path, openAs): read a file from the project.
- wkit.GetFile(path, openAs): read from the project first, then game archives.
- wkit.GetFileFromArchive(path, openAs): read from a base game archive.
- wkit.FileExistsInProject(path): check for a project file.
- wkit.FileExistsInRaw(filepath): check for a Raw-folder file.
- wkit.SaveToRaw(path, content): save text under the project Raw folder.
- wkit.SaveToResources(path, content): save text under project Resources.
- wkit.SaveToProject(path, file): add a CR2WFile or IGameFile to the project.
- wkit.DeleteFile(filepath, folderType): delete a project file; use only when explicitly requested.
- wkit.SuspendFileWatcher(true/false): suspend or resume project-tree updates during batches of file changes.
- wkit.ProgramVersion(): return the running WolvenKit version.

OpenAs provides output modes including GameFile, CR2W, and Json. Check the official API reference for overloads and current signatures.

## Logging

Import WolvenKit's Logger helper like this:

    import * as Logger from 'Logger.wscript';

It provides Info, Warning, Error, Success, and Debug logging functions.

## Sources

- Scripting with WScript: https://wiki.redmodding.org/wolvenkit/wolvenkit-app/usage/scripting-with-wscript
- WScript API documentation: https://wiki.redmodding.org/wolvenkit/wolvenkit-app/usage/wscript-api-docs
- Script Manager: https://wiki.redmodding.org/wolvenkit/wolvenkit-app/tools/script-manager
- Quest Editor: https://wiki.redmodding.org/wolvenkit/wolvenkit-app/editor/quest-editor
- Visualize Quest files: https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/quest/visualize-quest-files

The API list is generated from WolvenKit source and can change between versions. Check the official reference when writing scripts for a specific WolvenKit version.
