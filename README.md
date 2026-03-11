# SimpleMermaid

MediaWiki extension for rendering Mermaid diagrams from a CDN.

## Installation

`LocalSettings.php`

```php
wfLoadExtension( 'SimpleMermaid' );
```

## Usage

```wiki
<mermaid>
flowchart TD
	Start --> Check{OK?}
	Check -->|yes| Done
	Check -->|no| Retry
</mermaid>
```

Optional alignment:

```wiki
<mermaid align="center">
graph LR
	A --> B
</mermaid>
```

## UI Controls

- Diagram overlay buttons: `Code`, `Fullscreen`
- Code panel: top-right `Copy` button with `Copied` feedback
- Fullscreen only: mouse wheel zoom, drag pan, exit to reset view
- Dark mode: Mermaid theme follows MediaWiki skin theme classes, and component colors follow Codex design tokens
