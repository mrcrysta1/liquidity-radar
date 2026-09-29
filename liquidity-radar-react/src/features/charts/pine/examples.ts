// Built-in Pine examples for the editor — a selection of the Pro terminal's
// library (pro-terminal/src/core/pine/library.ts): original implementations
// of the standard public formulas, written for this engine's v5 subset.
// Open one in the editor to read or change it.

export interface PineExample {
  id: string
  name: string
  script: string
}

export const PINE_TEMPLATE = `//@version=5
indicator("My Indicator", overlay=false)
len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
value = ta.rsi(src, len)
plot(value, "Value", color=color.blue)
hline(70, "Upper", color=color.gray)
hline(30, "Lower", color=color.gray)
`

export const PINE_EXAMPLES: PineExample[] = [
  {
    id: 'ex_ema_cross',
    name: 'EMA Cross (signals)',
    script: `//@version=5
indicator("EMA Cross", overlay=true)
short = input.int(9, "Short", minval=1)
long = input.int(21, "Long", minval=1)
s = ta.ema(close, short)
l = ta.ema(close, long)
plot(s, "Short", color=color.green, linewidth=2)
plot(l, "Long", color=color.red, linewidth=2)
plotshape(ta.crossover(s, l), "Golden", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(ta.crossunder(s, l), "Death", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    id: 'ex_rsi_signals',
    name: 'RSI with overbought / oversold signals',
    script: `//@version=5
indicator("RSI Signals", overlay=false)
len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
ob = input.float(70, "Overbought")
os = input.float(30, "Oversold")
r = ta.rsi(src, len)
col = r > ob ? color.red : r < os ? color.green : color.purple
plot(r, "RSI", color=col, linewidth=2)
hline(ob, "Overbought", color=color.gray)
hline(50, "Middle", color=color.new(color.gray, 60), linestyle=hline.style_dotted)
hline(os, "Oversold", color=color.gray)
plotshape(ta.crossunder(r, os), "Oversold", style=shape.triangleup, location=location.bottom, color=color.green)
plotshape(ta.crossover(r, ob), "Overbought", style=shape.triangledown, location=location.top, color=color.red)`,
  },
  {
    id: 'ex_macd',
    name: 'MACD',
    script: `//@version=5
indicator("MACD", overlay=false)
fast = input.int(12, "Fast Length")
slow = input.int(26, "Slow Length")
src = input.source(close, "Source")
sig = input.int(9, "Signal Smoothing", minval=1, maxval=50)
macd = ta.ema(src, fast) - ta.ema(src, slow)
signal = ta.ema(macd, sig)
hist = macd - signal
histCol = hist >= 0 ? (hist[1] < hist ? color.new(color.green, 0) : color.new(color.green, 40)) : (hist[1] < hist ? color.new(color.red, 40) : color.new(color.red, 0))
plot(hist, "Histogram", style=plot.style_columns, color=histCol)
plot(macd, "MACD", color=color.blue)
plot(signal, "Signal", color=color.orange)
hline(0, "Zero Line", color=color.new(color.gray, 50))`,
  },
  {
    id: 'ex_bb',
    name: 'Bollinger Bands',
    script: `//@version=5
indicator("Bollinger Bands", "BB", overlay=true)
length = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
mult = input.float(2.0, "StdDev", minval=0.001, maxval=50)
basis = ta.sma(src, length)
dev = mult * ta.stdev(src, length)
plot(basis, "Basis", color=color.orange)
plot(basis + dev, "Upper", color=color.blue)
plot(basis - dev, "Lower", color=color.blue)`,
  },
  {
    id: 'ex_supertrend',
    name: 'Supertrend',
    script: `//@version=5
indicator("Supertrend", overlay=true)
atrPeriod = input.int(10, "ATR Length", minval=1)
factor = input.float(3.0, "Factor", minval=0.01, step=0.01)
[supertrend, direction] = ta.supertrend(factor, atrPeriod)
upTrend = direction < 0 ? supertrend : na
downTrend = direction < 0 ? na : supertrend
plot(upTrend, "Up Trend", color=color.green, style=plot.style_linebr, linewidth=2)
plot(downTrend, "Down Trend", color=color.red, style=plot.style_linebr, linewidth=2)
plotshape(ta.change(direction) < 0, "Buy", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(ta.change(direction) > 0, "Sell", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    id: 'ex_ichimoku',
    name: 'Ichimoku lines (user function)',
    script: `//@version=5
indicator("Ichimoku", overlay=true)
conversionPeriods = input.int(9, "Conversion Line Length", minval=1)
basePeriods = input.int(26, "Base Line Length", minval=1)
spanBPeriods = input.int(52, "Leading Span B Length", minval=1)
donchian(len) => math.avg(ta.lowest(low, len), ta.highest(high, len))
conversionLine = donchian(conversionPeriods)
baseLine = donchian(basePeriods)
plot(conversionLine, "Conversion Line", color=color.blue)
plot(baseLine, "Base Line", color=color.red)
plot(math.avg(conversionLine, baseLine), "Leading Span A", color=color.green, offset=basePeriods - 1)
plot(donchian(spanBPeriods), "Leading Span B", color=color.maroon, offset=basePeriods - 1)`,
  },
  {
    id: 'ex_stochrsi',
    name: 'Stochastic RSI',
    script: `//@version=5
indicator("Stochastic RSI", "Stoch RSI", overlay=false)
smoothK = input.int(3, "K", minval=1)
smoothD = input.int(3, "D", minval=1)
lengthRSI = input.int(14, "RSI Length", minval=1)
lengthStoch = input.int(14, "Stochastic Length", minval=1)
src = input.source(close, "RSI Source")
rsi1 = ta.rsi(src, lengthRSI)
k = ta.sma(ta.stoch(rsi1, rsi1, rsi1, lengthStoch), smoothK)
d = ta.sma(k, smoothD)
plot(k, "K", color=color.blue)
plot(d, "D", color=color.orange)
hline(80, "Upper Band", color=color.gray)
hline(20, "Lower Band", color=color.gray)`,
  },
  {
    id: 'ex_adx',
    name: 'ADX / DMI',
    script: `//@version=5
indicator("Directional Movement Index", "DMI", overlay=false)
lensig = input.int(14, "ADX Smoothing", minval=1, maxval=50)
len = input.int(14, "DI Length", minval=1)
[diplus, diminus, adx] = ta.dmi(len, lensig)
plot(adx, "ADX", color=color.red, linewidth=2)
plot(diplus, "+DI", color=color.blue)
plot(diminus, "-DI", color=color.orange)
hline(25, "Trend strength", color=color.gray)`,
  },
  {
    id: 'ex_pivots',
    name: 'Pivot Points High Low',
    script: `//@version=5
indicator("Pivot Points High Low", overlay=true)
lenL = input.int(5, "Pivot Length Left")
lenR = input.int(5, "Pivot Length Right")
ph = ta.pivothigh(high, lenL, lenR)
pl = ta.pivotlow(low, lenL, lenR)
plotshape(not na(ph), "Pivot High", style=shape.triangledown, location=location.abovebar, color=color.red)
plotshape(not na(pl), "Pivot Low", style=shape.triangleup, location=location.belowbar, color=color.green)
plot(ta.valuewhen(not na(ph), ph, 0), "Last pivot high", color=color.new(color.red, 40), style=plot.style_stepline)
plot(ta.valuewhen(not na(pl), pl, 0), "Last pivot low", color=color.new(color.green, 40), style=plot.style_stepline)`,
  },
  {
    id: 'ex_zscore',
    name: 'Z-Score',
    script: `//@version=5
indicator("Z-Score", overlay=false)
len = input.int(20, "Length", minval=2)
src = input.source(close, "Source")
z = (src - ta.sma(src, len)) / ta.stdev(src, len)
plot(z, "Z", color=color.blue, style=plot.style_columns)
hline(2, color=color.gray)
hline(0, color=color.new(color.gray, 50))
hline(-2, color=color.gray)`,
  },
  {
    id: 'ex_loop_avg',
    name: 'Loop average (for / var / history)',
    script: `//@version=5
indicator("Loop average", overlay=true)
n = input.int(10, "Bars", minval=1, maxval=200)
sum = 0.0
for i = 0 to n - 1
    sum += close[i]
avg = sum / n
var int streak = 0
if close > avg
    streak := streak + 1
else
    streak := 0
plot(avg, "Average", color=streak > 3 ? color.lime : color.orange, linewidth=2)`,
  },
]
