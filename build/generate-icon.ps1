Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 24, 32, 29))

$panel = [System.Drawing.RectangleF]::new(38, 42, 180, 172)
$panelBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 244, 245, 243))
$headerBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 43, 152, 120))
$accentPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 22, 112, 90), 17)
$mutedPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 183, 199, 189), 10)
$whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)

function Fill-RoundedRectangle {
  param(
    [System.Drawing.Graphics]$Target,
    [System.Drawing.Brush]$Brush,
    [System.Drawing.RectangleF]$Rect,
    [float]$Radius
  )
  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $Target.FillPath($Brush, $path)
  $path.Dispose()
}

Fill-RoundedRectangle $graphics $panelBrush $panel 18
Fill-RoundedRectangle $graphics $headerBrush ([System.Drawing.RectangleF]::new(38, 42, 180, 42)) 18
$graphics.FillRectangle($headerBrush, [System.Drawing.RectangleF]::new(38, 65, 180, 19))
$graphics.FillEllipse($whiteBrush, 58, 56, 14, 14)
$graphics.FillEllipse($whiteBrush, 81, 56, 14, 14)
$checkPoints = [System.Drawing.PointF[]]@(
  [System.Drawing.PointF]::new(72, 133),
  [System.Drawing.PointF]::new(91, 152),
  [System.Drawing.PointF]::new(134, 105)
)
$graphics.DrawLines($accentPen, $checkPoints)
$graphics.DrawLine($mutedPen, 68, 186, 189, 186)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bitmap.Save((Join-Path $root 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$handle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($handle)
$stream = [System.IO.File]::Open((Join-Path $root 'icon.ico'), [System.IO.FileMode]::Create)
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
$graphics.Dispose()
$panelBrush.Dispose()
$headerBrush.Dispose()
$accentPen.Dispose()
$mutedPen.Dispose()
$whiteBrush.Dispose()
$bitmap.Dispose()
