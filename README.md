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

- Diagram overlay buttons: `Copy`, `Fullscreen`
- Copy button: shows `Copied` feedback after copying the Mermaid source
- Fullscreen only: zoom in/out, directional pan, reset view, and exit
- Dark mode: Mermaid theme follows MediaWiki skin theme classes, and component colors follow Codex design tokens
