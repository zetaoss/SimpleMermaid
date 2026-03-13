( function () {
	var icons = require( './icons.json' );
	var URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
	var I = {
		fs: icons.cdxIconFullScreen,
		copy: icons.cdxIconCopy,
		check: icons.cdxIconCheck,
		exit: icons.cdxIconExitFullscreen,
		up: icons.cdxIconCollapse,
		down: icons.cdxIconExpand,
		left: icons.cdxIconPrevious,
		right: icons.cdxIconNext,
		reset: icons.cdxIconReload,
		plus: icons.cdxIconAdd,
		minus: icons.cdxIconSubtract
	};
	var COPY = {
		idle: { title: 'Copy', icon: I.copy },
		done: { title: 'Copied', icon: I.check }
	};
	var PAN = 80;
	var ZOOM = 0.2;
	var MAX = 2;
	var loadP;
	var initTheme = null;
	var active = 0;
	var wait = [];
	var items = [];
	var obs;
	var themeObs;
	var themeTimer;
	var fsBound = false;

	function load() {
		if ( !loadP ) {
			loadP = import( URL ).then( function ( mod ) {
				var m = mod && mod.default ? mod.default : mod;

				if ( !m || typeof m.render !== 'function' ) {
					throw new Error( 'Mermaid loaded, but the module API is unavailable.' );
				}

				return m;
			} ).catch( function ( err ) {
				loadP = null;
				throw err;
			} );
		}

		return loadP;
	}

	function clamp( n, min, max ) {
		return Math.min( max, Math.max( min, n ) );
	}

	function el( tag, cls, text ) {
		var node = document.createElement( tag );

		if ( cls ) {
			node.className = cls;
		}

		if ( typeof text === 'string' ) {
			node.textContent = text;
		}

		return node;
	}

	function dir() {
		var value = document.documentElement && document.documentElement.dir;
		return value === 'rtl' || value === 'ltr' ? value : 'ltr';
	}

	function iconData( icon ) {
		var d = dir();
		var markup;
		var flip = false;

		if ( typeof icon === 'string' ) {
			return { markup: icon, flip: false };
		}

		if ( icon && typeof icon === 'object' ) {
			if ( icon.rtl && d === 'rtl' ) {
				markup = icon.rtl;
			} else if ( icon.ltr ) {
				markup = icon.ltr;
				flip = !!icon.shouldFlip && d === 'rtl';
			} else if ( typeof icon.default === 'string' ) {
				markup = icon.default;
			}
		}

		return { markup: markup || '', flip: flip };
	}

	function iconEl( icon ) {
		var data = iconData( icon );
		var svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );

		svg.setAttribute( 'viewBox', '0 0 20 20' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.setAttribute( 'focusable', 'false' );
		svg.setAttribute( 'xmlns:xlink', 'http://www.w3.org/1999/xlink' );
		svg.classList.add( 'simple-mermaid-btn__svg' );
		svg.innerHTML = data.markup;

		if ( data.flip ) {
			svg.classList.add( 'simple-mermaid-btn__svg--flip' );
		}

		return svg;
	}

	function setBtn( btn, title, icon ) {
		var wrap = el( 'span', 'simple-mermaid-btn__icon' );

		btn.title = title;
		btn.setAttribute( 'aria-label', title );
		btn.textContent = '';
		wrap.appendChild( iconEl( icon ) );
		btn.appendChild( wrap );
	}

	function btn( title, icon, cls ) {
		var node = el( 'button', 'simple-mermaid-btn simple-mermaid-btn--icon' + ( cls ? ' ' + cls : '' ) );

		node.type = 'button';
		setBtn( node, title, icon );
		return node;
	}

	function setCopy( s, cfg ) {
		s.copyBtn.classList.toggle( 'is-copied', cfg === COPY.done );
		setBtn( s.copyBtn, cfg.title, cfg.icon );
	}

	function list( $content ) {
		var root = $content && $content[ 0 ] ? $content[ 0 ] : document;

		return Array.prototype.slice.call(
			root.querySelectorAll( '.simple-mermaid[data-simple-mermaid="1"]' )
		).filter( function ( node ) {
			return !node.__simpleMermaidState;
		} );
	}

	function norm( src ) {
		return src.replace( /^(?:\r?\n)+/, '' );
	}

	function isDark() {
		var html = document.documentElement;

		return html.classList.contains( 'skin-theme-clientpref-night' ) || (
			html.classList.contains( 'skin-theme-clientpref-os' ) &&
			window.matchMedia &&
			window.matchMedia( '(prefers-color-scheme: dark)' ).matches
		);
	}

	function layout( s ) {
		var w = Math.max( 120, s.w * s.scale );
		var h = Math.max( 80, s.h * s.scale );

		s.surf.style.width = w + 'px';
		s.surf.style.height = h + 'px';
		s.surf.style.transform = 'translate(' + s.x + 'px, ' + s.y + 'px)';
		s.canvas.style.width = s.w + 'px';
		s.canvas.style.height = s.h + 'px';

		if ( s.svg ) {
			s.svg.style.width = s.w + 'px';
			s.svg.style.height = s.h + 'px';
			s.svg.style.transform = 'scale(' + s.scale + ')';
			s.svg.style.transformOrigin = 'top left';
		}
	}

	function centerFs( s ) {
		window.requestAnimationFrame( function () {
			window.requestAnimationFrame( function () {
				if ( document.fullscreenElement !== s.root ) {
					return;
				}

				s.x = ( s.scroll.clientWidth - s.w * s.scale ) / 2;
				s.y = ( s.scroll.clientHeight - s.h * s.scale ) / 2;
				layout( s );
			} );
		} );
	}

	function reset( s ) {
		s.scale = 1;
		s.x = 0;
		s.y = 0;
		layout( s );
	}

	function resetFs( s ) {
		reset( s );

		if ( document.fullscreenElement === s.root ) {
			centerFs( s );
		}
	}

	function zoomTo( s, next, ax, ay ) {
		var prev = s.scale;
		var scale = clamp( next, 0.5, 4 );

		if ( prev === 0 ) {
			return;
		}

		s.x = ax - ( ax - s.x ) * ( scale / prev );
		s.y = ay - ( ay - s.y ) * ( scale / prev );
		s.scale = scale;
		layout( s );
	}

	function showErr( s, err ) {
		s.root.setAttribute( 'data-mermaid-state', 'error' );
		s.err.hidden = false;
		s.err.textContent = err && err.message ? err.message : 'Failed to render Mermaid diagram.';
		console.error( 'SimpleMermaid:', err );
	}

	function hideErr( s ) {
		s.err.hidden = true;
		s.err.textContent = '';
	}

	function drain() {
		var s;

		while ( active < MAX && wait.length ) {
			s = wait.shift();
			s.queued = false;

			if ( s.busy || !document.body || !document.body.contains( s.root ) ) {
				continue;
			}

			active++;
			( function ( cur ) {
				cur.busy = true;
				load()
					.then( function ( m ) {
						return renderOne( cur, m );
					} )
					.catch( function ( err ) {
						showErr( cur, err );
					} )
					.finally( function () {
						active--;
						cur.busy = false;
						drain();
					} );
			}( s ) );
		}
	}

	function queue( s, front ) {
		if ( s.queued || s.busy ) {
			return;
		}

		s.queued = true;
		if ( front ) {
			wait.unshift( s );
		} else {
			wait.push( s );
		}
		drain();
	}

	function near(node) {
		var rect = node.getBoundingClientRect();
		var margin = window.innerHeight || 0;

		return rect.bottom >= -margin && rect.top <= ( window.innerHeight || 0 ) + margin;
	}

	function ensureObs() {
		if ( obs || !window.IntersectionObserver ) {
			return;
		}

		obs = new IntersectionObserver( function ( entries ) {
			entries.forEach( function ( entry ) {
				var s = entry.target.__simpleMermaidState;

				if ( !entry.isIntersecting || !s ) {
					return;
				}

				obs.unobserve( entry.target );
				queue( s, false );
			} );
		}, {
			rootMargin: '100% 0px'
		} );
	}

	function syncFs() {
		var fs = document.fullscreenElement || null;

		items = items.filter( function ( s ) {
			return document.body && document.body.contains( s.root );
		} );

		items.forEach( function ( s ) {
			var on = fs === s.root;
			var wasOn = !!s.fs;

			if ( !on ) {
				reset( s );
			} else if ( !wasOn ) {
				centerFs( s );
			}

			s.fsBtn.classList.toggle( 'is-active', on );
			s.fsBtn.setAttribute( 'aria-pressed', on ? 'true' : 'false' );
			s.actions.hidden = on;
			s.ctrls.hidden = !on;
			s.fs = on;
		} );
	}

	function exitFs() {
		if ( document.exitFullscreen ) {
			document.exitFullscreen().catch( function ( err ) {
				console.error( 'SimpleMermaid:', err );
			} );
		}
	}

	function pulseCopy( s ) {
		clearTimeout( s.copyTimer );
		setCopy( s, COPY.done );
		s.copyTimer = setTimeout( function () {
			setCopy( s, COPY.idle );
		}, 1200 );
	}

	function copyText( text ) {
		if ( navigator.clipboard && window.isSecureContext !== false ) {
			return navigator.clipboard.writeText( text );
		}

		return new Promise( function ( resolve, reject ) {
			var area = document.createElement( 'textarea' );

			area.value = text;
			area.setAttribute( 'readonly', '' );
			area.style.position = 'fixed';
			area.style.top = '-9999px';
			document.body.appendChild( area );
			area.select();

			try {
				if ( document.execCommand( 'copy' ) ) {
					resolve();
				} else {
					reject( new Error( 'Copy command failed.' ) );
				}
			} catch ( err ) {
				reject( err );
			} finally {
				document.body.removeChild( area );
			}
		} );
	}

	function renderOne( s, m ) {
		var id = 'simple-mermaid-' + Date.now() + '-' + Math.random().toString( 36 ).slice( 2 );
		var token = ++s.token;
		var theme = isDark() ? 'dark' : 'default';

		s.root.setAttribute( 'data-mermaid-state', 'loading' );
		s.theme = theme;
		hideErr( s );

		if ( initTheme !== theme ) {
			m.initialize( {
				startOnLoad: false,
				securityLevel: 'strict',
				theme: theme
			} );
			initTheme = theme;
		}

		return m.render( id, s.src ).then( function ( out ) {
			var box;

			if ( token !== s.token ) {
				return;
			}

			s.canvas.innerHTML = out.svg;
			s.svg = s.canvas.querySelector( 'svg' );

			if ( !s.svg ) {
				throw new Error( 'Mermaid returned no SVG output.' );
			}

			if ( typeof out.bindFunctions === 'function' ) {
				out.bindFunctions( s.canvas );
			}

			s.svg.style.maxWidth = 'none';
			s.svg.removeAttribute( 'width' );
			s.svg.removeAttribute( 'height' );

			if ( s.svg.viewBox && s.svg.viewBox.baseVal && s.svg.viewBox.baseVal.width ) {
				s.w = s.svg.viewBox.baseVal.width;
				s.h = s.svg.viewBox.baseVal.height;
			} else if ( s.svg.getBBox ) {
				box = s.svg.getBBox();
				s.w = box.width || 320;
				s.h = box.height || 180;
			} else {
				s.w = 320;
				s.h = 180;
			}

			layout( s );

			if ( document.fullscreenElement === s.root ) {
				centerFs( s );
			}

			s.root.setAttribute( 'data-mermaid-state', 'rendered' );
		} );
	}

	function pan( s, dx, dy ) {
		if ( document.fullscreenElement !== s.root ) {
			return;
		}

		s.x += dx;
		s.y += dy;
		layout( s );
	}

	function copy( s ) {
		copyText( s.src )
			.then( function () {
				pulseCopy( s );
			} )
			.catch( function ( err ) {
				console.error( 'SimpleMermaid:', err );
			} );
	}

	function toggleFs( s ) {
		if ( !s.root.requestFullscreen ) {
			return;
		}

		if ( document.fullscreenElement === s.root ) {
			exitFs();
			return;
		}

		s.root.requestFullscreen().catch( function ( err ) {
			console.error( 'SimpleMermaid:', err );
		} );
	}

	function zoom( s, step ) {
		zoomTo(
			s,
			s.scale + step,
			s.scroll.clientWidth / 2,
			s.scroll.clientHeight / 2
		);
	}

	function syncThemeLater() {
		clearTimeout( themeTimer );
		themeTimer = setTimeout( function () {
			items.forEach( function ( s ) {
				if ( document.body && document.body.contains( s.root ) && s.theme !== ( isDark() ? 'dark' : 'default' ) ) {
					queue( s, true );
				}
			} );
		}, 50 );
	}

	function ensureThemeObs() {
		if ( themeObs || !window.MutationObserver || !document.body ) {
			return;
		}

		themeObs = new MutationObserver( syncThemeLater );
		themeObs.observe( document.documentElement, {
			attributes: true,
			attributeFilter: [ 'class' ]
		} );
	}

	function ensureFs() {
		if ( fsBound ) {
			return;
		}

		document.addEventListener( 'fullscreenchange', syncFs );
		fsBound = true;
	}

	function mount(node) {
		var s = {
			root: node,
			src: norm( node.textContent ),
			theme: null,
			scale: 1,
			x: 0,
			y: 0,
			w: 320,
			h: 180,
			token: 0,
			queued: false,
			busy: false,
			fs: false
		};
		var actions = el( 'div', 'simple-mermaid-actions' );
		var fsBtn = btn( 'Toggle fullscreen', I.fs, 'simple-mermaid-top-btn' );
		var copyBtn = btn( COPY.idle.title, COPY.idle.icon, 'simple-mermaid-top-btn' );
		var ctrls = el( 'div', 'simple-mermaid-controls' );
		var pad = el( 'div', 'simple-mermaid-pad' );
		var zoomCol = el( 'div', 'simple-mermaid-zoom' );
		var viewport = el( 'div', 'simple-mermaid-viewport' );
		var scroll = el( 'div', 'simple-mermaid-scroll' );
		var stage = el( 'div', 'simple-mermaid-stage' );
		var surf = el( 'div', 'simple-mermaid-surface' );
		var canvas = el( 'div', 'simple-mermaid-canvas' );
		var err = el( 'div', 'simple-mermaid-error' );
		var exitBtn = btn( 'Close fullscreen', I.exit, 'simple-mermaid-ctl' );
		var plusBtn = btn( 'Zoom in', I.plus, 'simple-mermaid-ctl' );
		var minusBtn = btn( 'Zoom out', I.minus, 'simple-mermaid-ctl' );
		var upBtn = btn( 'Pan up', I.up, 'simple-mermaid-ctl simple-mermaid-pad__up' );
		var leftBtn = btn( 'Pan left', I.left, 'simple-mermaid-ctl simple-mermaid-pad__left' );
		var resetBtn = btn( 'Reset view', I.reset, 'simple-mermaid-ctl simple-mermaid-pad__reset' );
		var rightBtn = btn( 'Pan right', I.right, 'simple-mermaid-ctl simple-mermaid-pad__right' );
		var downBtn = btn( 'Pan down', I.down, 'simple-mermaid-ctl simple-mermaid-pad__down' );

		node.__simpleMermaidState = s;
		node.classList.remove( 'mermaid' );
		node.setAttribute( 'data-simple-mermaid-mounted', '1' );
		node.setAttribute( 'data-mermaid-state', 'idle' );
		node.textContent = '';

		ctrls.hidden = true;
		err.hidden = true;
		err.setAttribute( 'role', 'status' );
		fsBtn.setAttribute( 'aria-pressed', 'false' );

		actions.appendChild( fsBtn );
		actions.appendChild( copyBtn );
		zoomCol.appendChild( exitBtn );
		zoomCol.appendChild( plusBtn );
		zoomCol.appendChild( minusBtn );
		pad.appendChild( upBtn );
		pad.appendChild( leftBtn );
		pad.appendChild( resetBtn );
		pad.appendChild( rightBtn );
		pad.appendChild( downBtn );
		ctrls.appendChild( pad );
		ctrls.appendChild( zoomCol );

		surf.appendChild( canvas );
		stage.appendChild( surf );
		scroll.appendChild( stage );
		viewport.appendChild( actions );
		viewport.appendChild( ctrls );
		viewport.appendChild( scroll );
		node.appendChild( viewport );
		node.appendChild( err );

		fsBtn.addEventListener( 'click', function () {
			toggleFs( s );
		} );
		copyBtn.addEventListener( 'click', function () {
			copy( s );
		} );
		exitBtn.addEventListener( 'click', exitFs );
		plusBtn.addEventListener( 'click', function () {
			zoom( s, ZOOM );
		} );
		minusBtn.addEventListener( 'click', function () {
			zoom( s, -ZOOM );
		} );
		upBtn.addEventListener( 'click', function () {
			pan( s, 0, PAN );
		} );
		leftBtn.addEventListener( 'click', function () {
			pan( s, PAN, 0 );
		} );
		resetBtn.addEventListener( 'click', function () {
			resetFs( s );
		} );
		rightBtn.addEventListener( 'click', function () {
			pan( s, -PAN, 0 );
		} );
		downBtn.addEventListener( 'click', function () {
			pan( s, 0, -PAN );
		} );

		s.scroll = scroll;
		s.surf = surf;
		s.canvas = canvas;
		s.err = err;
		s.actions = actions;
		s.ctrls = ctrls;
		s.fsBtn = fsBtn;
		s.copyBtn = copyBtn;

		layout( s );
		items.push( s );
		syncFs();

		if ( near( node ) || !obs ) {
			queue( s, true );
		} else {
			obs.observe( node );
		}
	}

	function render( $content ) {
		var nodes = list( $content );

		if ( !nodes.length ) {
			return;
		}

		ensureThemeObs();
		ensureFs();
		ensureObs();
		nodes.forEach( mount );
	}

	mw.hook( 'wikipage.content' ).add( render );
}() );
