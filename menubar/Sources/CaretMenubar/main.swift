import AppKit
import CaretMenubarCore

let config: LaunchConfig
do {
    config = try LaunchConfig(arguments: CommandLine.arguments.dropFirst())
} catch {
    FileHandle.standardError.write(Data("caret-menubar: \(error)\n".utf8))
    exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = StatusController(config: config)
controller.start()
app.run()
