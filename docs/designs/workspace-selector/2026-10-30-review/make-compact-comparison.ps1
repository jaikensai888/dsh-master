$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$canvas = [System.Drawing.Bitmap]::new(1050, 580)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#111113'))
$font = [System.Drawing.Font]::new('Microsoft YaHei', 14)
$small = [System.Drawing.Font]::new('Microsoft YaHei', 10)
$white = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#eeeeef'))
$gray = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#a8a8b2'))
$graphics.DrawString('新版 · 工作区文字后的小三角切换节点', $font, $white, 22, 15)
$panels = @(
  @{File='compact-default.jpg'; X=22; W=282; Title='默认：工作区 + 小三角'},
  @{File='compact-menu.jpg'; X=322; W=400; Title='点击三角：展开本地 / 节点菜单'},
  @{File='compact-search.jpg'; X=740; W=282; Title='点击放大镜：原位搜索'}
)
foreach ($panel in $panels) {
  $graphics.DrawString($panel.Title, $small, $white, $panel.X, 64)
  $source = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot $panel.File))
  $target = [System.Drawing.Rectangle]::new($panel.X, 96, $panel.W, 445)
  $crop = [System.Drawing.Rectangle]::new(24, 370, $panel.W, 445)
  $graphics.DrawImage($source, $target, $crop, [System.Drawing.GraphicsUnit]::Pixel)
  $source.Dispose()
}
$graphics.DrawString('移除整块节点卡片；目录直接接标题栏。切换节点仍保留右侧当前会话。', $small, $gray, 22, 550)
$canvas.Save((Join-Path $PSScriptRoot 'compact-selector-comparison.jpg'), [System.Drawing.Imaging.ImageFormat]::Jpeg)
$graphics.Dispose(); $canvas.Dispose(); $font.Dispose(); $small.Dispose(); $white.Dispose(); $gray.Dispose()
