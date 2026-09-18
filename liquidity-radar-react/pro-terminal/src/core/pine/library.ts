/**
 * Built-in indicator library written in Pine Script (v5 subset) and executed by our own runtime.
 * These are original implementations of well-known public indicator formulas (the same ones TradingView ships
 * as built-ins), NOT copies of TradingView's source. Users can open any of them in the editor and modify.
 */
export interface PineLibraryItem { id: string; name: string; category: string; tags: string[]; script: string }

export const PINE_LIBRARY: PineLibraryItem[] = [
  { id: 'lib_rsi', name: 'Relative Strength Index', category: 'Momentum', tags: ['rsi', 'oscillator'], script: `//@version=5
indicator("Relative Strength Index", "RSI", overlay=false)
len = input.int(14, "RSI Length", minval=1)
src = input.source(close, "Source")
maLen = input.int(14, "MA Length", minval=1)
up = ta.rma(math.max(ta.change(src), 0), len)
down = ta.rma(-math.min(ta.change(src), 0), len)
rsi = down == 0 ? 100 : up == 0 ? 0 : 100 - (100 / (1 + up / down))
plot(rsi, "RSI", color=color.purple)
plot(ta.sma(rsi, maLen), "RSI-based MA", color=color.yellow)
hline(70, "Upper Band", color=color.gray)
hline(50, "Middle Band", color=color.new(color.gray, 50))
hline(30, "Lower Band", color=color.gray)` },
  { id: 'lib_macd', name: 'MACD', category: 'Momentum', tags: ['macd', 'moving average convergence divergence'], script: `//@version=5
indicator("MACD", overlay=false)
fast = input.int(12, "Fast Length")
slow = input.int(26, "Slow Length")
src = input.source(close, "Source")
sig = input.int(9, "Signal Smoothing", minval=1, maxval=50)
fastMA = ta.ema(src, fast)
slowMA = ta.ema(src, slow)
macd = fastMA - slowMA
signal = ta.ema(macd, sig)
hist = macd - signal
histCol = hist >= 0 ? (hist[1] < hist ? color.new(color.green, 0) : color.new(color.green, 40)) : (hist[1] < hist ? color.new(color.red, 40) : color.new(color.red, 0))
plot(hist, "Histogram", style=plot.style_columns, color=histCol)
plot(macd, "MACD", color=color.blue)
plot(signal, "Signal", color=color.orange)
hline(0, "Zero Line", color=color.new(color.gray, 50))` },
  { id: 'lib_bb', name: 'Bollinger Bands', category: 'Volatility', tags: ['bollinger', 'bands', 'bb'], script: `//@version=5
indicator("Bollinger Bands", "BB", overlay=true)
length = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
mult = input.float(2.0, "StdDev", minval=0.001, maxval=50)
basis = ta.sma(src, length)
dev = mult * ta.stdev(src, length)
plot(basis, "Basis", color=color.orange)
plot(basis + dev, "Upper", color=color.blue)
plot(basis - dev, "Lower", color=color.blue)` },
  { id: 'lib_ma', name: 'Moving Average (SMA/EMA/WMA/HMA/VWMA)', category: 'Trend', tags: ['ma', 'sma', 'ema', 'wma', 'hma', 'vwma', 'moving average'], script: `//@version=5
indicator("Moving Average", "MA", overlay=true)
len = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
typ = input.string("EMA", "Type", options=["SMA", "EMA", "WMA", "HMA", "VWMA", "RMA"])
ma = typ == "SMA" ? ta.sma(src, len) : typ == "WMA" ? ta.wma(src, len) : typ == "HMA" ? ta.hma(src, len) : typ == "VWMA" ? ta.vwma(src, len) : typ == "RMA" ? ta.rma(src, len) : ta.ema(src, len)
plot(ma, "MA", color=color.blue, linewidth=2)` },
  { id: 'lib_ema_ribbon', name: 'EMA Ribbon', category: 'Trend', tags: ['ema', 'ribbon'], script: `//@version=5
indicator("EMA Ribbon", overlay=true)
src = input.source(close, "Source")
plot(ta.ema(src, 20), "EMA 20", color=color.new(color.blue, 0))
plot(ta.ema(src, 25), "EMA 25", color=color.new(color.blue, 15))
plot(ta.ema(src, 30), "EMA 30", color=color.new(color.blue, 30))
plot(ta.ema(src, 35), "EMA 35", color=color.new(color.blue, 45))
plot(ta.ema(src, 40), "EMA 40", color=color.new(color.blue, 55))
plot(ta.ema(src, 45), "EMA 45", color=color.new(color.blue, 65))
plot(ta.ema(src, 50), "EMA 50", color=color.new(color.blue, 75))
plot(ta.ema(src, 55), "EMA 55", color=color.new(color.blue, 85))` },
  { id: 'lib_supertrend', name: 'Supertrend', category: 'Trend', tags: ['supertrend', 'atr'], script: `//@version=5
indicator("Supertrend", overlay=true)
atrPeriod = input.int(10, "ATR Length", minval=1)
factor = input.float(3.0, "Factor", minval=0.01, step=0.01)
[supertrend, direction] = ta.supertrend(factor, atrPeriod)
upTrend = direction < 0 ? supertrend : na
downTrend = direction < 0 ? na : supertrend
plot(upTrend, "Up Trend", color=color.green, style=plot.style_linebr, linewidth=2)
plot(downTrend, "Down Trend", color=color.red, style=plot.style_linebr, linewidth=2)
plotshape(ta.change(direction) < 0, "Buy", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(ta.change(direction) > 0, "Sell", style=shape.triangledown, location=location.abovebar, color=color.red)` },
  { id: 'lib_ichimoku', name: 'Ichimoku Cloud', category: 'Trend', tags: ['ichimoku', 'cloud', 'kumo'], script: `//@version=5
indicator("Ichimoku Cloud", overlay=true)
conversionPeriods = input.int(9, "Conversion Line Length", minval=1)
basePeriods = input.int(26, "Base Line Length", minval=1)
laggingSpan2Periods = input.int(52, "Leading Span B Length", minval=1)
donchian(len) => math.avg(ta.lowest(low, len), ta.highest(high, len))
conversionLine = donchian(conversionPeriods)
baseLine = donchian(basePeriods)
leadLine1 = math.avg(conversionLine, baseLine)
leadLine2 = donchian(laggingSpan2Periods)
plot(conversionLine, "Conversion Line", color=color.blue)
plot(baseLine, "Base Line", color=color.red)
plot(leadLine1, "Leading Span A", color=color.green)
plot(leadLine2, "Leading Span B", color=color.maroon)` },
  { id: 'lib_vwap', name: 'VWAP (session)', category: 'Volume', tags: ['vwap', 'volume weighted'], script: `//@version=5
indicator("VWAP", overlay=true)
src = input.source(hlc3, "Source")
plot(ta.vwap(src), "VWAP", color=color.blue)` },
  { id: 'lib_stoch', name: 'Stochastic', category: 'Momentum', tags: ['stochastic', 'stoch', 'oscillator'], script: `//@version=5
indicator("Stochastic", "Stoch", overlay=false)
periodK = input.int(14, "%K Length", minval=1)
smoothK = input.int(1, "%K Smoothing", minval=1)
periodD = input.int(3, "%D Smoothing", minval=1)
k = ta.sma(ta.stoch(close, high, low, periodK), smoothK)
d = ta.sma(k, periodD)
plot(k, "%K", color=color.blue)
plot(d, "%D", color=color.orange)
hline(80, "Upper Band", color=color.gray)
hline(20, "Lower Band", color=color.gray)` },
  { id: 'lib_stochrsi', name: 'Stochastic RSI', category: 'Momentum', tags: ['stochastic rsi', 'stochrsi'], script: `//@version=5
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
hline(20, "Lower Band", color=color.gray)` },
  { id: 'lib_atr', name: 'Average True Range', category: 'Volatility', tags: ['atr', 'volatility'], script: `//@version=5
indicator("Average True Range", "ATR", overlay=false)
length = input.int(14, "Length", minval=1)
plot(ta.atr(length), "ATR", color=color.red)` },
  { id: 'lib_adx', name: 'Average Directional Index (ADX / DMI)', category: 'Trend', tags: ['adx', 'dmi', 'directional'], script: `//@version=5
indicator("Directional Movement Index", "DMI", overlay=false)
lensig = input.int(14, "ADX Smoothing", minval=1, maxval=50)
len = input.int(14, "DI Length", minval=1)
[diplus, diminus, adx] = ta.dmi(len, lensig)
plot(adx, "ADX", color=color.red, linewidth=2)
plot(diplus, "+DI", color=color.blue)
plot(diminus, "-DI", color=color.orange)
hline(25, "Trend strength", color=color.gray)` },
  { id: 'lib_cci', name: 'Commodity Channel Index', category: 'Momentum', tags: ['cci'], script: `//@version=5
indicator("Commodity Channel Index", "CCI", overlay=false)
length = input.int(20, "Length", minval=1)
src = input.source(hlc3, "Source")
ma = ta.sma(src, length)
cci = (src - ma) / (0.015 * ta.dev(src, length))
plot(cci, "CCI", color=color.blue)
hline(100, "Upper Band", color=color.gray)
hline(0, "Middle", color=color.new(color.gray, 50))
hline(-100, "Lower Band", color=color.gray)` },
  { id: 'lib_wpr', name: 'Williams %R', category: 'Momentum', tags: ['williams', '%r', 'wpr'], script: `//@version=5
indicator("Williams Percent Range", "Williams %R", overlay=false)
length = input.int(14, "Length", minval=1)
plot(ta.wpr(length), "%R", color=color.purple)
hline(-20, "Upper Band", color=color.gray)
hline(-80, "Lower Band", color=color.gray)` },
  { id: 'lib_mfi', name: 'Money Flow Index', category: 'Volume', tags: ['mfi', 'money flow'], script: `//@version=5
indicator("Money Flow Index", "MFI", overlay=false)
length = input.int(14, "Length", minval=1)
src = input.source(hlc3, "Source")
plot(ta.mfi(src, length), "MF", color=color.purple)
hline(80, "Overbought", color=color.gray)
hline(20, "Oversold", color=color.gray)` },
  { id: 'lib_obv', name: 'On Balance Volume', category: 'Volume', tags: ['obv', 'on balance volume'], script: `//@version=5
indicator("On Balance Volume", "OBV", overlay=false)
plot(ta.obv(), "OnBalanceVolume", color=color.blue)` },
  { id: 'lib_volume', name: 'Volume', category: 'Volume', tags: ['volume', 'vol'], script: `//@version=5
indicator("Volume", overlay=false)
showMA = input.bool(true, "Show MA")
maLen = input.int(20, "MA Length", minval=1)
plot(volume, "Volume", style=plot.style_columns, color=close >= open ? color.new(color.green, 40) : color.new(color.red, 40))
plot(showMA ? ta.sma(volume, maLen) : na, "Volume MA", color=color.yellow)` },
  { id: 'lib_ao', name: 'Awesome Oscillator', category: 'Momentum', tags: ['awesome', 'ao', 'bill williams'], script: `//@version=5
indicator("Awesome Oscillator", "AO", overlay=false)
ao = ta.sma(hl2, 5) - ta.sma(hl2, 34)
diff = ao - ao[1]
plot(ao, "AO", style=plot.style_columns, color=diff <= 0 ? color.red : color.green)` },
  { id: 'lib_mom', name: 'Momentum', category: 'Momentum', tags: ['momentum', 'mom'], script: `//@version=5
indicator("Momentum", "Mom", overlay=false)
len = input.int(10, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.mom(src, len), "MOM", color=color.blue)
hline(0, color=color.gray)` },
  { id: 'lib_roc', name: 'Rate Of Change', category: 'Momentum', tags: ['roc', 'rate of change'], script: `//@version=5
indicator("Rate Of Change", "ROC", overlay=false)
length = input.int(9, "Length", minval=1)
source = input.source(close, "Source")
plot(ta.roc(source, length), "ROC", color=color.blue)
hline(0, color=color.gray)` },
  { id: 'lib_keltner', name: 'Keltner Channels', category: 'Volatility', tags: ['keltner', 'kc'], script: `//@version=5
indicator("Keltner Channels", "KC", overlay=true)
length = input.int(20, "Length", minval=1)
mult = input.float(2.0, "Multiplier")
src = input.source(close, "Source")
atrlength = input.int(10, "ATR Length")
ma = ta.ema(src, length)
rangema = ta.atr(atrlength)
plot(ma, "Basis", color=color.blue)
plot(ma + rangema * mult, "Upper", color=color.blue)
plot(ma - rangema * mult, "Lower", color=color.blue)` },
  { id: 'lib_donchian', name: 'Donchian Channels', category: 'Volatility', tags: ['donchian', 'channel', 'breakout'], script: `//@version=5
indicator("Donchian Channels", "DC", overlay=true)
length = input.int(20, "Length", minval=1)
lower = ta.lowest(low, length)
upper = ta.highest(high, length)
basis = math.avg(upper, lower)
plot(basis, "Basis", color=color.orange)
plot(upper, "Upper", color=color.blue)
plot(lower, "Lower", color=color.blue)` },
  { id: 'lib_sar', name: 'Parabolic SAR', category: 'Trend', tags: ['sar', 'parabolic'], script: `//@version=5
indicator("Parabolic SAR", "SAR", overlay=true)
start = input.float(0.02, "Start")
increment = input.float(0.02, "Increment")
maximum = input.float(0.2, "Max Value")
plot(ta.sar(start, increment, maximum), "ParabolicSAR", style=plot.style_circles, color=color.blue)` },
  { id: 'lib_bbpct', name: 'Bollinger Bands %B', category: 'Volatility', tags: ['bollinger', '%b'], script: `//@version=5
indicator("Bollinger Bands %B", "BB %B", overlay=false)
length = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
mult = input.float(2.0, "StdDev")
[basis, upper, lower] = ta.bb(src, length, mult)
plot((src - lower) / (upper - lower), "Bollinger Bands %B", color=color.teal)
hline(1, "Overbought", color=color.gray)
hline(0, "Oversold", color=color.gray)` },
  { id: 'lib_bbw', name: 'Bollinger Bands Width', category: 'Volatility', tags: ['bollinger', 'width', 'squeeze'], script: `//@version=5
indicator("Bollinger Bands Width", "BBW", overlay=false)
length = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
mult = input.float(2.0, "StdDev")
plot(ta.bbw(src, length, mult), "Bollinger Bands Width", color=color.teal)` },
  { id: 'lib_trix', name: 'TRIX', category: 'Momentum', tags: ['trix'], script: `//@version=5
indicator("TRIX", overlay=false)
length = input.int(18, "Length", minval=1)
out = 10000 * ta.change(ta.ema(ta.ema(ta.ema(math.log(close), length), length), length))
plot(out, "TRIX", color=color.red)
hline(0, color=color.gray)` },
  { id: 'lib_uo', name: 'Ultimate Oscillator', category: 'Momentum', tags: ['ultimate', 'uo'], script: `//@version=5
indicator("Ultimate Oscillator", "UO", overlay=false)
length7 = input.int(7, "Fast Length", minval=1)
length14 = input.int(14, "Middle Length", minval=1)
length28 = input.int(28, "Slow Length", minval=1)
average(bp, tr_, length) => math.sum(bp, length) / math.sum(tr_, length)
high_ = math.max(high, close[1])
low_ = math.min(low, close[1])
bp = close - low_
tr_ = high_ - low_
avg7 = average(bp, tr_, length7)
avg14 = average(bp, tr_, length14)
avg28 = average(bp, tr_, length28)
out = 100 * (4 * avg7 + 2 * avg14 + avg28) / 7
plot(out, "UO", color=color.red)` },
  { id: 'lib_cmf', name: 'Chaikin Money Flow', category: 'Volume', tags: ['chaikin', 'cmf'], script: `//@version=5
indicator("Chaikin Money Flow", "CMF", overlay=false)
length = input.int(20, "Length", minval=1)
ad = close == high and close == low or high == low ? 0 : ((2 * close - low - high) / (high - low)) * volume
mf = math.sum(ad, length) / math.sum(volume, length)
plot(mf, "MF", color=color.green)
hline(0, color=color.gray)` },
  { id: 'lib_aroon', name: 'Aroon', category: 'Trend', tags: ['aroon'], script: `//@version=5
indicator("Aroon", overlay=false)
length = input.int(14, "Length", minval=1)
upper = 100 * (ta.highestbars(high, length + 1) + length) / length
lower = 100 * (ta.lowestbars(low, length + 1) + length) / length
plot(upper, "Aroon Up", color=color.orange)
plot(lower, "Aroon Down", color=color.blue)` },
  { id: 'lib_chop', name: 'Choppiness Index', category: 'Volatility', tags: ['choppiness', 'chop'], script: `//@version=5
indicator("Choppiness Index", "CHOP", overlay=false)
length = input.int(14, "Length", minval=1)
ci = 100 * math.log10(math.sum(ta.atr(1), length) / (ta.highest(high, length) - ta.lowest(low, length))) / math.log10(length)
plot(ci, "CHOP", color=color.blue)
hline(61.8, "Upper Band", color=color.gray)
hline(38.2, "Lower Band", color=color.gray)` },
  { id: 'lib_vortex', name: 'Vortex Indicator', category: 'Trend', tags: ['vortex', 'vi'], script: `//@version=5
indicator("Vortex Indicator", "VI", overlay=false)
period_ = input.int(14, "Period", minval=2)
VMP = math.sum(math.abs(high - low[1]), period_)
VMM = math.sum(math.abs(low - high[1]), period_)
STR = math.sum(ta.atr(1), period_)
plot(VMP / STR, "VI +", color=color.blue)
plot(VMM / STR, "VI -", color=color.red)` },
  { id: 'lib_cmo', name: 'Chande Momentum Oscillator', category: 'Momentum', tags: ['chande', 'cmo'], script: `//@version=5
indicator("Chande Momentum Oscillator", "ChandeMO", overlay=false)
length = input.int(9, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.cmo(src, length), "ChandeMO", color=color.blue)
hline(50, color=color.gray)
hline(-50, color=color.gray)` },
  { id: 'lib_tsi', name: 'True Strength Index', category: 'Momentum', tags: ['tsi'], script: `//@version=5
indicator("True Strength Index", "TSI", overlay=false)
long = input.int(25, "Long Length")
short = input.int(13, "Short Length")
signal = input.int(13, "Signal Length")
price = close
tsi = 100 * ta.tsi(price, short, long)
plot(tsi, "TSI", color=color.blue)
plot(ta.ema(tsi, signal), "Signal", color=color.red)
hline(0, color=color.gray)` },
  { id: 'lib_linreg', name: 'Linear Regression Curve', category: 'Trend', tags: ['linreg', 'regression'], script: `//@version=5
indicator("Linear Regression Curve", overlay=true)
len = input.int(50, "Length", minval=2)
src = input.source(close, "Source")
plot(ta.linreg(src, len, 0), "LinReg", color=color.blue, linewidth=2)` },
  { id: 'lib_pivots', name: 'Pivot Points High Low', category: 'Structure', tags: ['pivot', 'swing', 'high', 'low'], script: `//@version=5
indicator("Pivot Points High Low", overlay=true)
lenL = input.int(5, "Pivot Length Left")
lenR = input.int(5, "Pivot Length Right")
ph = ta.pivothigh(high, lenL, lenR)
pl = ta.pivotlow(low, lenL, lenR)
plotshape(not na(ph), "Pivot High", style=shape.triangledown, location=location.abovebar, color=color.red)
plotshape(not na(pl), "Pivot Low", style=shape.triangleup, location=location.belowbar, color=color.green)
plot(ta.valuewhen(not na(ph), ph, 0), "Last pivot high", color=color.new(color.red, 40), style=plot.style_stepline)
plot(ta.valuewhen(not na(pl), pl, 0), "Last pivot low", color=color.new(color.green, 40), style=plot.style_stepline)` },
  { id: 'lib_zscore', name: 'Z-Score', category: 'Statistics', tags: ['zscore', 'z-score', 'stdev'], script: `//@version=5
indicator("Z-Score", overlay=false)
len = input.int(20, "Length", minval=2)
src = input.source(close, "Source")
z = (src - ta.sma(src, len)) / ta.stdev(src, len)
plot(z, "Z", color=color.blue)
hline(2, color=color.gray)
hline(0, color=color.new(color.gray, 50))
hline(-2, color=color.gray)` },
  { id: 'lib_hv', name: 'Historical Volatility', category: 'Volatility', tags: ['hv', 'historical volatility'], script: `//@version=5
indicator("Historical Volatility", "HV", overlay=false)
length = input.int(10, "Length", minval=1)
annual = 365
per = 1
hv = 100 * ta.stdev(math.log(close / close[1]), length) * math.sqrt(annual / per)
plot(hv, "HV", color=color.blue)` },
  { id: 'lib_ema_cross', name: 'EMA Cross (signals)', category: 'Trend', tags: ['ema', 'cross', 'signal'], script: `//@version=5
indicator("EMA Cross", overlay=true)
short = input.int(9, "Short")
long = input.int(21, "Long")
s = ta.ema(close, short)
l = ta.ema(close, long)
plot(s, "Short", color=color.green)
plot(l, "Long", color=color.red)
plotshape(ta.crossover(s, l), "Golden", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(ta.crossunder(s, l), "Death", style=shape.triangledown, location=location.abovebar, color=color.red)` },
];
export const PINE_TEMPLATE = `//@version=5
indicator("My Indicator", overlay=false)
len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
value = ta.rsi(src, len)
plot(value, "Value", color=color.blue)
hline(70, "Upper", color=color.gray)
hline(30, "Lower", color=color.gray)
`;
