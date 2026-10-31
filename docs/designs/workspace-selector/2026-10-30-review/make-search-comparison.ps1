$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$canvas = [System.Drawing.Bitmap]::new(700, 565)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#111113'))
$font = [System.Drawing.Font]::new('Microsoft YaHei', 14)
$small = [System.Drawing.Font]::new('Microsoft YaHei', 10)
$white = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#eeeeef'))
$gray = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#a8a8b2'))
$graphics.DrawString('搜索交互修订 · 默认收起，点击后原位展开', $font, $white, 22, 15)
$panels = @(
  @{File='search-collapsed.jpg'; X=22; Title='默认：工作区标题 + 放大镜'},
  @{File='search-expanded.jpg'; X=370; Title='点击后：标题栏变为搜索框'}
)
foreach ($panel in $panels) {
  $graphics.DrawString($panel.Title, $small, $white, $panel.X, 64)
  $source = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot $panel.File))
  $target = [System.Drawing.Rectangle]::new($panel.X, 96, 282, 410)
  $crop = [System.Drawing.Rectangle]::new(24, 370, 282, 410)
  $graphics.DrawImage($source, $target, $crop, [System.Drawing.GraphicsUnit]::Pixel)
  $source.Dispose()
}
$graphics.DrawString('节点下拉持续可见；点击 × 或按 Escape 清空搜索并恢复标题栏。', $small, $gray, 22, 529)
$canvas.Save((Join-Path $PSScriptRoot 'search-comparison.jpg'), [System.Drawing.Imaging.ImageFormat]::Jpeg)
$graphics.Dispose(); $canvas.Dispose(); $font.Dispose(); $small.Dispose(); $white.Dispose(); $gray.Dispose()
