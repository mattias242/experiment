// WebGL2-renderaren: ritar varje splat som en fyrkant som grafikkortet
// formar till en tvådimensionell gaussisk klick.
//
// Varje splats data ligger i en heltalstextur (två texlar per splat, se
// packa() i splatdata.js). Fyrkanterna ritas instansierat i den ordning som
// sorteringen ger, bakifrån och fram, och blandas med vanlig
// förmultiplicerad alfa.
'use strict';

const HORNSKUGGARE = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D u_data;
uniform mat4 u_projektion;
uniform mat4 u_modellvy;
uniform vec2 u_fokal;     // brännvidd i pixlar
uniform vec2 u_vy;        // ritytans storlek i pixlar
uniform float u_narmast;  // splattar närmare ögat än så här (vyrummets z) ritas inte

in vec2 a_horn;
in uint a_index;

out vec4 v_farg;
out vec2 v_pos;

const vec4 BORT = vec4(0.0, 0.0, 2.0, 1.0);

void main() {
  ivec2 t = ivec2(int(a_index & 1023u) << 1, int(a_index >> 10));
  uvec4 a = texelFetch(u_data, t, 0);
  vec4 kam = u_modellvy * vec4(uintBitsToFloat(a.xyz), 1.0);
  vec4 klipp = u_projektion * kam;
  float marg = 1.2 * klipp.w;
  if (kam.z > u_narmast || klipp.w <= 0.0 || abs(klipp.x) > marg || abs(klipp.y) > marg) {
    gl_Position = BORT;
    return;
  }

  uvec4 b = texelFetch(u_data, t + ivec2(1, 0), 0);
  vec2 k1 = unpackHalf2x16(b.x), k2 = unpackHalf2x16(b.y), k3 = unpackHalf2x16(b.z);
  mat3 sigma = mat3(k1.x, k1.y, k2.x,
                    k1.y, k2.y, k3.x,
                    k2.x, k3.x, k3.y);

  // Perspektivprojektionens jacobian i splattens mittpunkt: hur pixlarna rör
  // sig när punkten flyttas i vyrummet. Den gör den tredimensionella
  // kovariansen till en tvådimensionell på skärmen.
  float iz = 1.0 / kam.z;
  mat3 J = mat3(-u_fokal.x * iz, 0.0, 0.0,
                0.0, -u_fokal.y * iz, 0.0,
                u_fokal.x * kam.x * iz * iz, u_fokal.y * kam.y * iz * iz, 0.0);
  mat3 T = J * mat3(u_modellvy);
  mat3 c = T * sigma * transpose(T);

  // +0,3 px² är originalets kantutjämning: inget blir smalare än en pixel.
  float xx = c[0][0] + 0.3, xy = c[0][1], yy = c[1][1] + 0.3;
  float mitt = 0.5 * (xx + yy);
  float radie = length(vec2(0.5 * (xx - yy), xy));
  float l1 = mitt + radie, l2 = mitt - radie;
  if (l2 <= 0.0) { gl_Position = BORT; return; }
  vec2 e1 = abs(xy) < 1e-9 ? (xx >= yy ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) : normalize(vec2(xy, l1 - xx));
  vec2 e2 = vec2(-e1.y, e1.x);

  float alfa = float(a.w >> 24) / 255.0;
  // Hur många standardavvikelser ut klicken syns innan den blir svagare än
  // 1/255. Svaga splattar får mindre fyrkanter, vilket sparar mycket arbete
  // åt grafikkortet på en telefon.
  float r = min(3.0, sqrt(max(0.0, 2.0 * log(255.0 * alfa))));
  if (r <= 0.0) { gl_Position = BORT; return; }

  vec2 ax1 = min(sqrt(l1), 1024.0) * e1;
  vec2 ax2 = min(sqrt(l2), 1024.0) * e2;
  v_pos = a_horn * r;
  v_farg = vec4(float(a.w & 255u), float((a.w >> 8) & 255u), float((a.w >> 16) & 255u), 0.0) / 255.0;
  v_farg.a = alfa;
  vec2 mittpunkt = klipp.xy / klipp.w;
  gl_Position = vec4(mittpunkt + (v_pos.x * ax1 + v_pos.y * ax2) * 2.0 / u_vy, 0.0, 1.0);
}
`;

const FARGSKUGGARE = `#version 300 es
precision highp float;

in vec4 v_farg;
in vec2 v_pos;
out vec4 fragFarg;

void main() {
  float a = exp(-0.5 * dot(v_pos, v_pos)) * v_farg.a;
  if (a < 1.0 / 255.0) discard;
  fragFarg = vec4(v_farg.rgb * a, a);
}
`;

class Renderare {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: true, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.antal = 0;

    const skuggare = (typ, kod) => {
      const s = gl.createShader(typ);
      gl.shaderSource(s, kod);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, skuggare(gl.VERTEX_SHADER, HORNSKUGGARE));
    gl.attachShader(p, skuggare(gl.FRAGMENT_SHADER, FARGSKUGGARE));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.program = p;
    gl.useProgram(p);
    this.u = {};
    for (const n of ['u_data', 'u_projektion', 'u_modellvy', 'u_fokal', 'u_vy', 'u_narmast']) {
      this.u[n] = gl.getUniformLocation(p, n);
    }

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const horn = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, horn);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    const aHorn = gl.getAttribLocation(p, 'a_horn');
    gl.enableVertexAttribArray(aHorn);
    gl.vertexAttribPointer(aHorn, 2, gl.FLOAT, false, 0, 0);

    this.indexbuffert = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexbuffert);
    const aIndex = gl.getAttribLocation(p, 'a_index');
    gl.enableVertexAttribArray(aIndex);
    gl.vertexAttribIPointer(aIndex, 1, gl.UNSIGNED_INT, 0, 0);
    gl.vertexAttribDivisor(aIndex, 1);

    this.textur = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.textur);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.u_data, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  get maxSplattar() {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) * 1024;
  }

  laddaScen(packad) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.textur);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, packad.bredd, packad.hojd, 0,
      gl.RGBA_INTEGER, gl.UNSIGNED_INT, packad.data);
    this.antal = 0; // inget ritas förrän första sorteringen kommit
  }

  sattOrdning(ordning) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexbuffert);
    gl.bufferData(gl.ARRAY_BUFFER, ordning, gl.DYNAMIC_DRAW);
    this.antal = ordning.length;
  }

  // Ritytan i fysiska pixlar. Returnerar true om storleken ändrats.
  anpassa(pixelkvot) {
    const c = this.canvas;
    const b = Math.max(1, Math.round(c.clientWidth * pixelkvot));
    const h = Math.max(1, Math.round(c.clientHeight * pixelkvot));
    if (c.width === b && c.height === h) return false;
    c.width = b; c.height = h;
    return true;
  }

  rita({ projektion, modellvy, narmast, bakgrund }) {
    const gl = this.gl, b = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, b, h);
    gl.clearColor(bakgrund[0], bakgrund[1], bakgrund[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.antal) return;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textur);
    gl.uniformMatrix4fv(this.u.u_projektion, false, projektion);
    gl.uniformMatrix4fv(this.u.u_modellvy, false, modellvy);
    // projektionens skalfaktorer gånger halva ritytan = brännvidd i pixlar
    gl.uniform2f(this.u.u_fokal, projektion[0] * b / 2, projektion[5] * h / 2);
    gl.uniform2f(this.u.u_vy, b, h);
    gl.uniform1f(this.u.u_narmast, narmast);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.antal);
  }
}

if (typeof window !== 'undefined') window.Renderare = Renderare;
