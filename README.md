# WolvenKit Q003 Inspector

A local Codex plugin for producing and returning a compact, read-only metadata report for Cyberpunk 2077's q003 quest resources. It also provides guarded tools for editing local WolvenKit `.wscript` automation files.

The bundled WScript reads these three resources from WolvenKit's mounted game archives:

- `base\quest\main_quests\prologue\q003\q003.questphase`
- `base\quest\main_quests\prologue\q003\phases\q003_royce_deal.questphase`
- `base\quest\main_quests\prologue\q003\scenes\q003_03_deal.scene`

The report includes node IDs and types, selected fact write/check fields, socket names, connection targets, scene exits, and attempted exit-to-fact-write traces. It treats the named output sockets on the q003_03_deal `questSceneNodeDefinition` in q003_royce_deal.questphase as exits and follows serialized source/destination socket handles through that phase graph, including nested JSON-encoded connection records. Unresolved wires remain explicit in the report rather than being guessed.

## Read-only resource handling

The WScript uses `wkit.GetFileFromArchive(..., OpenAs.Json)` and emits one compact JSON record to WolvenKit's application log. It does not export JSON files, save to Raw or Resources, edit project files, package archives, or write vanilla game resources. The Codex plugin reads that report record from the normal WolvenKit log directory and returns it in chat.

To use the report:

1. Install this plugin in Codex Desktop.
2. Ask Codex to install the bundled q003 report script. It creates `q003_wolvenkit_readonly_report.wscript` only if that filename is absent.
3. If that filename already exists, ask Codex to read it first. After reviewing the existing source, update it with the hash-guarded `update_q003_report_script` tool; the tool creates a timestamped backup before replacing it with the bundled version.
4. Open the script in WolvenKit's Script Manager and run it there.
5. Ask Codex to read the latest q003 report.

The plugin does not run WScripts. WolvenKit must be open and the user runs the report script in its Script Manager. If the wire handles cannot be mapped to node IDs or an exit label cannot be matched to a scene-manager socket, the report marks that route unresolved.

## Editing other WScript automation

The plugin can list, read, create, and safely replace top-level `.wscript` files in `%APPDATA%\REDModding\WolvenKit\WScript`. Existing-script edits require the SHA-256 returned by `read_script`; every replacement saves a timestamped backup. The dedicated report updater also requires the current script's hash and backs it up before installing the bundled version. The server never executes scripts. Review any script that writes project data before running it in WolvenKit.

The bundled skill explains the q003 report workflow and the guardrails for script edits. The WScript API reference links to the official WolvenKit documentation.

## Requirements

- Windows with WolvenKit installed and its game archives configured.
- Codex Desktop with local plugin support.
- Node.js 18 or newer available as `node` on `PATH`.

## Install from this repository

1. Clone the repository and open its folder in Codex Desktop.
2. Restart Codex Desktop so it discovers `.agents/plugins/marketplace.json`.
3. In the Plugins Directory, select the WolvenKit Q003 Inspector marketplace and install the plugin.
4. Start a new chat and follow the report workflow above.

## Local data access

The local MCP server reads the bundled report script, reads and writes the WolvenKit WScript directory, and reads WolvenKit's application logs for the report marker. The q003 report script reads resources through WolvenKit's archive API. The plugin does not upload logs, user scripts, archives, or game resources.

## License

MIT. See [LICENSE](LICENSE).
