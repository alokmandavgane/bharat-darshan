// Clean-cut, paler clay sides (PLAN.md section 3).
uniform vec3 uWall;
in float vLit;
in float vT;
out vec4 outColor;
void main() {
  vec3 col = uWall * vLit * (0.86 + 0.14 * vT);
  outColor = linearToOutputTexel(vec4(col, 1.0));
}
