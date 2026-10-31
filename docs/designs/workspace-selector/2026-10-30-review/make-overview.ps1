$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$canvas = [System.Drawing.Bitmap]::new(1260, 860)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#111113'))
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$font = [System.Drawing.Font]::new('Microsoft YaHei', 15)
$small = [System.Drawing.Font]::new('Microsoft YaHei', 10)
$white = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#eeeeef'))
$gray = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#a8a8b2'))
$graphics.DrawString('DSH 侧栏选择器 · 待审核方案', $font, $white, 24, 15)
$graphics.DrawString('A 推荐按节点选择；B 按目录选择。下拉只改变浏览范围，右侧会话保持。', $small, $gray, 24, 49)
$panels = @(
  @{File='node-list.jpg'; X=24; W=282; Title='A / 单一节点的目录与会话'; Note='固定选择器，下方一个滚动区'},
  @{File='node-picker.jpg'; X=324; W=400; Title='A / 下拉选择本地或节点'; Note='显示在线状态，可搜索、独立滚动'},
  @{File='directory-picker.jpg'; X=742; W=400; Title='B / 直接选择具体工作区'; Note='按节点分组，以路径区分重名目录'}
)
foreach ($panel in $panels) {
  $graphics.DrawString($panel.Title, $small, $white, $panel.X, 88)
  $source = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot $panel.File))
  $target = [System.Drawing.Rectangle]::new($panel.X, 120, $panel.W, 680)
  $crop = [System.Drawing.Rectangle]::new(24, 185, $panel.W, 680)
  $graphics.DrawImage($source, $target, $crop, [System.Drawing.GraphicsUnit]::Pixel)
  $source.Dispose()
  $graphics.DrawString($panel.Note, $small, $gray, $panel.X, 817)
}
$canvas.Save((Join-Path $PSScriptRoot 'overview.jpg'), [System.Drawing.Imaging.ImageFormat]::Jpeg)
$graphics.Dispose(); $canvas.Dispose(); $font.Dispose(); $small.Dispose(); $white.Dispose(); $gray.Dispose()
