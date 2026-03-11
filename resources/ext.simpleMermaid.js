( function () {
	var iconDefinitions = require( './icons.json' );
	var CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
	var ICONS = {
		check: iconDefinitions.cdxIconCheck,
		code: iconDefinitions.cdxIconCode,
		fullscreen: iconDefinitions.cdxIconFullScreen,
		copy: iconDefinitions.cdxIconCopy
	};
	var COPY_BUTTON_STATES = {
		idle: {
			label: 'Copy',
			icon: ICONS.copy
		},
		copied: {
			label: 'Copied',
			icon: ICONS.check
		}
	};
	var loadPromise;
	var renderQueue = Promise.resolve();
	var widgets = [];
	var widgetId = 0;
	var themeObserver;
	var themeSyncTimer;
	var fullscreenListenerAttached = false;

	function loadMermaid() {
		if ( !loadPromise ) {
			loadPromise = import( CDN_URL ).then( function ( module ) {
				var mermaid = module && module.default ? module.default : module;

				if ( !mermaid || typeof mermaid.render !== 'function' ) {
					throw new Error( 'Mermaid loaded, but the module API is unavailable.' );
				}

				return mermaid;
			} ).catch( function ( error ) {
				loadPromise = null;
				throw error;
			} );
		}

		return loadPromise;
	}

	function clamp( value, min, max ) {
		return Math.min( max, Math.max( min, value ) );
	}

	function createElement( tagName, className, text ) {
		var element = document.createElement( tagName );

		if ( className ) {
			element.className = className;
		}

		if ( typeof text === 'string' ) {
			element.textContent = text;
		}

		return element;
	}

	function getDocumentDirection() {
		var dir = document.documentElement && document.documentElement.dir;

		if ( dir === 'rtl' || dir === 'ltr' ) {
			return dir;
		}

		return 'ltr';
	}

	function resolveIconMarkup( iconDefinition ) {
		var dir = getDocumentDirection();
		var icon = iconDefinition;
		var markup;
		var shouldFlip = false;

		if ( typeof icon === 'string' ) {
			return {
				markup: icon,
				shouldFlip: false
			};
		}

		if ( icon && typeof icon === 'object' ) {
			if ( icon.rtl && dir === 'rtl' ) {
				markup = icon.rtl;
			} else if ( icon.ltr ) {
				markup = icon.ltr;
				shouldFlip = !!icon.shouldFlip && dir === 'rtl';
			} else if ( typeof icon.default === 'string' ) {
				markup = icon.default;
			}
		}

		return {
			markup: markup || '',
			shouldFlip: shouldFlip
		};
	}

	function createIcon( iconDefinition ) {
		var namespace = 'http://www.w3.org/2000/svg';
		var svg = document.createElementNS( namespace, 'svg' );
		var iconData = resolveIconMarkup( iconDefinition );

		svg.setAttribute( 'viewBox', '0 0 20 20' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.setAttribute( 'focusable', 'false' );
		svg.setAttribute( 'xmlns:xlink', 'http://www.w3.org/1999/xlink' );
		svg.classList.add( 'simple-mermaid-button__icon-svg' );
		svg.innerHTML = iconData.markup;

		if ( iconData.shouldFlip ) {
			svg.classList.add( 'simple-mermaid-button__icon-svg--flipped' );
		}

		return svg;
	}

	function setButtonTitle( button, title ) {
		button.title = title;
		button.setAttribute( 'aria-label', title );
	}

	function setButtonContent( button, iconDefinition, label ) {
		var iconWrap = button.querySelector( '.simple-mermaid-button__icon' );
		var labelWrap = button.querySelector( '.simple-mermaid-button__label' );

		if ( !iconWrap ) {
			iconWrap = createElement( 'span', 'simple-mermaid-button__icon' );
			button.appendChild( iconWrap );
		}

		iconWrap.textContent = '';
		iconWrap.appendChild( createIcon( iconDefinition ) );

		if ( typeof label !== 'string' ) {
			return;
		}

		if ( !labelWrap ) {
			labelWrap = createElement( 'span', 'simple-mermaid-button__label' );
			button.appendChild( labelWrap );
		}

		labelWrap.textContent = label;
	}

	function createButton( title, iconDefinition, extraClass, label ) {
		var button = createElement(
			'button',
			'simple-mermaid-button ' +
			( typeof label === 'string' ? 'simple-mermaid-button--labelled' : 'simple-mermaid-button--icon' ) +
			( extraClass ? ' ' + extraClass : '' )
		);

		button.type = 'button';
		setButtonTitle( button, title );
		setButtonContent( button, iconDefinition, label );

		return button;
	}

	function setCopyButtonState( state, config ) {
		state.copyButton.classList.toggle( 'is-copied', config === COPY_BUTTON_STATES.copied );
		setButtonTitle( state.copyButton, config.label );
		setButtonContent( state.copyButton, config.icon, config.label );
	}

	function getRenderableNodes( $content ) {
		var root = $content && $content[ 0 ] ? $content[ 0 ] : document;

		return Array.prototype.slice.call(
			root.querySelectorAll( '.simple-mermaid[data-simple-mermaid="1"]' )
		).filter( function ( node ) {
			return !node.__simpleMermaidState;
		} );
	}

	function normalizeSource( source ) {
		return source.replace( /^(?:\r?\n)+/, '' );
	}

	function isDarkMode() {
		var html = document.documentElement;

		return html.classList.contains( 'skin-theme-clientpref-night' ) || (
			html.classList.contains( 'skin-theme-clientpref-os' ) &&
			window.matchMedia &&
			window.matchMedia( '(prefers-color-scheme: dark)' ).matches
		);
	}

	function applySurfaceLayout( state ) {
		var width = Math.max( 120, state.baseWidth * state.scale );
		var height = Math.max( 80, state.baseHeight * state.scale );

		state.surface.style.width = width + 'px';
		state.surface.style.height = height + 'px';
		state.surface.style.transform = 'translate(' + state.panX + 'px, ' + state.panY + 'px)';
		state.canvas.style.width = state.baseWidth + 'px';
		state.canvas.style.height = state.baseHeight + 'px';

		if ( state.svg ) {
			state.svg.style.width = state.baseWidth + 'px';
			state.svg.style.height = state.baseHeight + 'px';
			state.svg.style.transform = 'scale(' + state.scale + ')';
			state.svg.style.transformOrigin = 'top left';
		}
	}

	function centerInFullscreen( state ) {
		window.requestAnimationFrame( function () {
			window.requestAnimationFrame( function () {
				if ( document.fullscreenElement !== state.root ) {
					return;
				}

				state.panX = ( state.scroll.clientWidth - state.baseWidth * state.scale ) / 2;
				state.panY = ( state.scroll.clientHeight - state.baseHeight * state.scale ) / 2;
				applySurfaceLayout( state );
			} );
		} );
	}

	function resetView( state ) {
		state.scale = 1;
		state.panX = 0;
		state.panY = 0;
		applySurfaceLayout( state );
	}

	function setScale( state, nextScale, anchorX, anchorY ) {
		var previousScale = state.scale;
		var nextValue = clamp( nextScale, 0.5, 4 );

		if ( previousScale === 0 ) {
			return;
		}

		state.panX = anchorX - ( anchorX - state.panX ) * ( nextValue / previousScale );
		state.panY = anchorY - ( anchorY - state.panY ) * ( nextValue / previousScale );
		state.scale = nextValue;
		applySurfaceLayout( state );
	}

	function startDrag( state, event ) {
		if ( event.button !== 0 ) {
			return;
		}

		if ( event.target.closest && event.target.closest( 'a' ) ) {
			return;
		}

		if ( document.fullscreenElement !== state.root ) {
			return;
		}

		state.drag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startPanX: state.panX,
			startPanY: state.panY,
			moved: false
		};

		if ( state.scroll.setPointerCapture && typeof event.pointerId === 'number' ) {
			state.scroll.setPointerCapture( event.pointerId );
		}

		state.scroll.classList.add( 'is-dragging' );
		event.preventDefault();
	}

	function moveDrag( state, event ) {
		var deltaX;
		var deltaY;

		if ( !state.drag || state.drag.pointerId !== event.pointerId ) {
			return;
		}

		deltaX = event.clientX - state.drag.startX;
		deltaY = event.clientY - state.drag.startY;

		if ( Math.abs( deltaX ) > 2 || Math.abs( deltaY ) > 2 ) {
			state.drag.moved = true;
		}

		state.panX = state.drag.startPanX + deltaX;
		state.panY = state.drag.startPanY + deltaY;
		applySurfaceLayout( state );

		if ( state.drag.moved ) {
			event.preventDefault();
		}
	}

	function stopDrag( state ) {
		if ( !state.drag ) {
			return;
		}

		if (
			state.scroll.releasePointerCapture &&
			typeof state.drag.pointerId === 'number' &&
			state.scroll.hasPointerCapture &&
			state.scroll.hasPointerCapture( state.drag.pointerId )
		) {
			state.scroll.releasePointerCapture( state.drag.pointerId );
		}

		state.scroll.classList.remove( 'is-dragging' );

		if ( state.drag.moved ) {
			state.suppressClick = true;
			setTimeout( function () {
				state.suppressClick = false;
			}, 0 );
		}

		state.drag = null;
	}

	function showError( state, error ) {
		var message = error && error.message ? error.message : 'Failed to render Mermaid diagram.';

		state.root.setAttribute( 'data-mermaid-state', 'error' );
		state.error.hidden = false;
		state.error.textContent = message;
		console.error( 'SimpleMermaid:', error );
	}

	function hideError( state ) {
		state.error.hidden = true;
		state.error.textContent = '';
	}

	function updateFullscreenButtons() {
		var fullscreenElement = document.fullscreenElement || null;

		widgets = widgets.filter( function ( state ) {
			return document.body && document.body.contains( state.root );
		} );

		widgets.forEach( function ( state ) {
			var active = fullscreenElement === state.root;
			var wasActive = !!state.isFullscreenActive;

			if ( !active ) {
				stopDrag( state );
				resetView( state );
			} else if ( !wasActive ) {
				centerInFullscreen( state );
			}

			state.fullscreenButton.classList.toggle( 'is-active', active );
			state.fullscreenButton.setAttribute( 'aria-pressed', active ? 'true' : 'false' );
			state.isFullscreenActive = active;
		} );
	}

	function exitFullscreen() {
		if ( document.exitFullscreen ) {
			document.exitFullscreen().catch( function ( error ) {
				console.error( 'SimpleMermaid:', error );
			} );
		}
	}

	function pulseCopyButton( state ) {
		clearTimeout( state.copyTimer );
		setCopyButtonState( state, COPY_BUTTON_STATES.copied );
		state.copyTimer = setTimeout( function () {
			setCopyButtonState( state, COPY_BUTTON_STATES.idle );
		}, 1200 );
	}

	function copyText( text ) {
		if ( navigator.clipboard && window.isSecureContext !== false ) {
			return navigator.clipboard.writeText( text );
		}

		return new Promise( function ( resolve, reject ) {
			var textarea = document.createElement( 'textarea' );

			textarea.value = text;
			textarea.setAttribute( 'readonly', '' );
			textarea.style.position = 'fixed';
			textarea.style.top = '-9999px';
			document.body.appendChild( textarea );
			textarea.select();

			try {
				if ( document.execCommand( 'copy' ) ) {
					resolve();
				} else {
					reject( new Error( 'Copy command failed.' ) );
				}
			} catch ( error ) {
				reject( error );
			} finally {
				document.body.removeChild( textarea );
			}
		} );
	}

	function renderSvg( state, mermaid ) {
		var renderId = 'simple-mermaid-' + ( ++widgetId );
		var token = ++state.renderToken;
		var resolvedTheme = isDarkMode() ? 'dark' : 'default';

		state.root.setAttribute( 'data-mermaid-state', 'loading' );
		state.resolvedTheme = resolvedTheme;
		hideError( state );

		return new Promise( function ( resolve, reject ) {
			renderQueue = renderQueue.catch( function () {
				return null;
			} ).then( function () {
				mermaid.initialize( {
					startOnLoad: false,
					securityLevel: 'strict',
					theme: resolvedTheme
				} );

				return mermaid.render( renderId, state.source );
			} );

			return renderQueue.then( function ( renderResult ) {
				var box;

				if ( token !== state.renderToken ) {
					resolve();
					return;
				}

				state.canvas.innerHTML = renderResult.svg;
				state.svg = state.canvas.querySelector( 'svg' );

				if ( !state.svg ) {
					throw new Error( 'Mermaid returned no SVG output.' );
				}

				if ( typeof renderResult.bindFunctions === 'function' ) {
					renderResult.bindFunctions( state.canvas );
				}

				state.svg.style.maxWidth = 'none';
				state.svg.removeAttribute( 'width' );
				state.svg.removeAttribute( 'height' );

				if ( state.svg.viewBox && state.svg.viewBox.baseVal && state.svg.viewBox.baseVal.width ) {
					state.baseWidth = state.svg.viewBox.baseVal.width;
					state.baseHeight = state.svg.viewBox.baseVal.height;
				} else if ( state.svg.getBBox ) {
					box = state.svg.getBBox();
					state.baseWidth = box.width || 320;
					state.baseHeight = box.height || 180;
				} else {
					state.baseWidth = 320;
					state.baseHeight = 180;
				}

				applySurfaceLayout( state );
				if ( document.fullscreenElement === state.root ) {
					centerInFullscreen( state );
				}
				state.root.setAttribute( 'data-mermaid-state', 'rendered' );
				resolve();
			} ).catch( reject );
		} );
	}

	function renderWidget( state ) {
		return loadMermaid()
			.then( function ( mermaid ) {
				return renderSvg( state, mermaid );
			} )
			.catch( function ( error ) {
				showError( state, error );
			} );
	}

	function toggleCode( state ) {
		state.codeOpen = !state.codeOpen;
		state.codePanel.hidden = !state.codeOpen;
		state.codeButton.classList.toggle( 'is-active', state.codeOpen );
		state.codeButton.setAttribute( 'aria-pressed', state.codeOpen ? 'true' : 'false' );
	}

	function copySource( state ) {
		copyText( state.source )
			.then( function () {
				pulseCopyButton( state );
			} )
			.catch( function ( error ) {
				console.error( 'SimpleMermaid:', error );
			} );
	}

	function toggleFullscreen( state ) {
		if ( !state.root.requestFullscreen ) {
			return;
		}

		if ( document.fullscreenElement === state.root ) {
			exitFullscreen();
			return;
		}

		state.root.requestFullscreen().catch( function ( error ) {
			console.error( 'SimpleMermaid:', error );
		} );
	}

	function scheduleThemeSync() {
		clearTimeout( themeSyncTimer );
		themeSyncTimer = setTimeout( function () {
			widgets.forEach( function ( state ) {
				if ( !document.body || !document.body.contains( state.root ) ) {
					return;
				}

				if ( ( isDarkMode() ? 'dark' : 'default' ) !== state.resolvedTheme ) {
					renderWidget( state );
				}
			} );
		}, 50 );
	}

	function ensureThemeObserver() {
		if ( themeObserver || !window.MutationObserver || !document.body ) {
			return;
		}

		themeObserver = new MutationObserver( scheduleThemeSync );
		themeObserver.observe( document.documentElement, {
			attributes: true,
			attributeFilter: [ 'class' ]
		} );
	}

	function ensureFullscreenListener() {
		if ( fullscreenListenerAttached ) {
			return;
		}

		document.addEventListener( 'fullscreenchange', updateFullscreenButtons );
		fullscreenListenerAttached = true;
	}

	function mountNode( node ) {
		var source = normalizeSource( node.textContent );
		var state = {
			root: node,
			source: source,
			resolvedTheme: null,
			scale: 1,
			panX: 0,
			panY: 0,
			baseWidth: 320,
			baseHeight: 180,
			renderToken: 0,
			codeOpen: false,
			isFullscreenActive: false
		};
		var codePanel = createElement( 'div', 'simple-mermaid-code-panel' );
		var code = createElement( 'pre', 'simple-mermaid-code' );
		var copyButton = createButton(
			COPY_BUTTON_STATES.idle.label,
			COPY_BUTTON_STATES.idle.icon,
			'simple-mermaid-copy-button',
			COPY_BUTTON_STATES.idle.label
		);
		var viewport = createElement( 'div', 'simple-mermaid-viewport' );
		var overlayActions = createElement( 'div', 'simple-mermaid-overlay-actions' );
		var scroll = createElement( 'div', 'simple-mermaid-scroll' );
		var stage = createElement( 'div', 'simple-mermaid-stage' );
		var surface = createElement( 'div', 'simple-mermaid-surface' );
		var canvas = createElement( 'div', 'simple-mermaid-canvas' );
		var error = createElement( 'div', 'simple-mermaid-error' );
		var codeButton = createButton( 'Toggle code', ICONS.code );
		var fullscreenButton = createButton( 'Toggle fullscreen', ICONS.fullscreen );

		node.__simpleMermaidState = state;
		node.classList.remove( 'mermaid' );
		node.setAttribute( 'data-simple-mermaid-mounted', '1' );
		node.setAttribute( 'data-mermaid-state', 'idle' );
		node.textContent = '';

		codePanel.hidden = true;
		error.hidden = true;
		error.setAttribute( 'role', 'status' );
		code.textContent = source;
		codeButton.setAttribute( 'aria-pressed', 'false' );
		fullscreenButton.setAttribute( 'aria-pressed', 'false' );

		surface.appendChild( canvas );
		stage.appendChild( surface );
		scroll.appendChild( stage );
		viewport.appendChild( overlayActions );
		viewport.appendChild( scroll );
		codePanel.appendChild( copyButton );
		codePanel.appendChild( code );

		overlayActions.appendChild( codeButton );
		overlayActions.appendChild( fullscreenButton );

		codeButton.addEventListener( 'click', function () {
			toggleCode( state );
		} );
		fullscreenButton.addEventListener( 'click', function () {
			toggleFullscreen( state );
		} );
		copyButton.addEventListener( 'click', function () {
			copySource( state );
		} );
		scroll.addEventListener( 'pointerdown', function ( event ) {
			startDrag( state, event );
		} );
		scroll.addEventListener( 'pointermove', function ( event ) {
			moveDrag( state, event );
		} );
		scroll.addEventListener( 'pointerup', function () {
			stopDrag( state );
		} );
		scroll.addEventListener( 'pointercancel', function () {
			stopDrag( state );
		} );
		scroll.addEventListener( 'click', function ( event ) {
			if ( state.suppressClick ) {
				event.preventDefault();
				event.stopPropagation();
				state.suppressClick = false;
			}
		}, true );
		scroll.addEventListener( 'dragstart', function ( event ) {
			event.preventDefault();
		} );
		scroll.addEventListener( 'wheel', function ( event ) {
			var rect = scroll.getBoundingClientRect();
			var nextScale = state.scale + ( event.deltaY < 0 ? 0.1 : -0.1 );

			if ( document.fullscreenElement !== state.root ) {
				return;
			}

			event.preventDefault();
			setScale(
				state,
				nextScale,
				event.clientX - rect.left,
				event.clientY - rect.top
			);
		}, { passive: false } );

		state.viewport = viewport;
		state.scroll = scroll;
		state.surface = surface;
		state.canvas = canvas;
		state.codePanel = codePanel;
		state.error = error;
		state.codeButton = codeButton;
		state.fullscreenButton = fullscreenButton;
		state.copyButton = copyButton;

		node.appendChild( viewport );
		node.appendChild( codePanel );
		node.appendChild( error );

		applySurfaceLayout( state );
		widgets.push( state );
		updateFullscreenButtons();
		renderWidget( state );
	}

	function render( $content ) {
		var nodes = getRenderableNodes( $content );

		if ( !nodes.length ) {
			return;
		}

		ensureThemeObserver();
		ensureFullscreenListener();
		nodes.forEach( mountNode );
	}

	mw.hook( 'wikipage.content' ).add( render );
}() );
