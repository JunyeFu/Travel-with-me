import { afterEach, describe, expect, it, vi } from 'vitest';
import { initMap, drawRoutePaths } from '../render/map.js';
import { setAMap, setMap, setInfoWindow, getAppState } from '../state.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setMap(null);
  setInfoWindow(null);
  setAMap(null);
  getAppState().routeOverlays.clear();
});

describe('AMap native arrow shader repair', () => {
  it('corrects only the known clamp expression on the map context', () => {
    vi.stubGlobal('document', { getElementById: () => ({ dataset: {} }) });
    const shaderSource = vi.fn();
    const gl = { shaderSource };
    const otherContext = { shaderSource };
    const map = { getContext: () => ({ gl }), addControl: vi.fn() };
    const AMap = {
      Map: class {
        constructor() {
          return map;
        }
      },
      ToolBar: class {},
      Pixel: class {},
      InfoWindow: class {}
    };
    setAMap(AMap);
    initMap(AMap);
    drawRoutePaths({ id: 'shader-test' }, []);
    const repaired = gl.shaderSource;
    drawRoutePaths({ id: 'shader-test' }, []);
    expect(gl.shaderSource).toBe(repaired);
    const shader = {};
    gl.shaderSource(shader, '1.0 - clamp(0.0,1.0,text_offset_x/icon_size.x)');
    expect(shaderSource).toHaveBeenLastCalledWith(
      shader,
      '1.0 - clamp(text_offset_x/icon_size.x,0.0,1.0)'
    );
    expect(shaderSource.mock.contexts[0]).toBe(gl);
    const ordinary = 'gl_FragColor = vec4(1.0);';
    gl.shaderSource(shader, ordinary);
    expect(shaderSource).toHaveBeenLastCalledWith(shader, ordinary);
    expect(otherContext.shaderSource).toBe(shaderSource);
  });

  it('leaves the local fallback map without WebGL unchanged', () => {
    vi.stubGlobal('document', { getElementById: () => ({ dataset: {} }) });
    const map = { addControl: vi.fn() };
    setAMap({ __fallback: true });
    expect(
      initMap({
        __fallback: true,
        Map: class {
          constructor() {
            return map;
          }
        },
        ToolBar: class {},
        Pixel: class {},
        InfoWindow: class {}
      }).map
    ).toBe(map);
    expect(() => drawRoutePaths({ id: 'shader-test' }, [])).not.toThrow();
  });
});
