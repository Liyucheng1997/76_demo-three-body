// 物理常数与单位制
// ------------------------------------------------------------
// 模拟内部采用天文单位制：
//   长度 = 天文单位 AU，质量 = 太阳质量 M☉，时间 = 儒略年 yr
// 在该单位制下 G = 4π²（开普勒第三定律 P² = a³ / M 自然成立）。

export const G = 4 * Math.PI * Math.PI;          // AU³ / (M☉ · yr²)

export const AU_M = 1.495978707e11;              // 1 AU（米）
export const YEAR_S = 3.15576e7;                 // 1 儒略年（秒）
export const DAY_YR = 1 / 365.25;

export const R_SUN_AU = 6.957e8 / AU_M;          // 太阳半径（AU）≈ 0.00465
export const R_EARTH_AU = 6.371e6 / AU_M;
export const M_EARTH = 3.003489e-6;              // 地球质量（M☉）

export const S0 = 1361;                          // 太阳常数（W/m²）：1 L☉ 在 1 AU 处的辐照度
export const SIGMA = 5.670374419e-8;             // 斯特藩-玻尔兹曼常数
export const T_SUN = 5772;                       // 太阳有效温度（K）
export const KELVIN = 273.15;
