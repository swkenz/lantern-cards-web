# Builds the pictures projected onto the Meshy heroine sculpts (assets/art/heroines3d/<id>.jpg).
# Same crop Meshy received, but where other characters were masked out in white, the heroine's
# edge colours are stretched across instead, so geometry there picks up her colours, not white.
param([string]$Source = "$env:TEMP\claude\0ec78cf5c0a9c370\2bdc58f6-2ad9-4941-b72f-613405cd8aee\scratchpad\downloads\heroines")

Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\assets\art\heroines3d'
New-Item -ItemType Directory -Force $out | Out-Null
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 88L

# crop = x, y, w, h in the full picture; masks = x0, y0, x1, y1 in the full picture; side = which edge to smear from
$jobs = @(
  @{ id = 'minase';  crop = @(250, 0, 600, 1500);  masks = @(@(250, 0, 306, 480, 'right'), @(730, 260, 850, 670, 'left')) },
  @{ id = 'homura';  crop = @(200, 150, 700, 1350); masks = @(@(200, 0, 400, 470, 'right'), @(200, 470, 290, 660, 'right'), @(724, 430, 900, 1200, 'left')) },
  @{ id = 'tsubaki'; crop = @(175, 150, 700, 1350); masks = @(@(175, 80, 385, 500, 'right'), @(175, 500, 335, 940, 'right'), @(759, 480, 875, 1240, 'left')) }
)

foreach ($job in $jobs) {
  $full = [System.Drawing.Bitmap]::FromFile((Join-Path $Source "$($job.id)_full.png"))
  $c = $job.crop
  $bmp = New-Object System.Drawing.Bitmap $c[2], $c[3]
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($full, (New-Object System.Drawing.Rectangle 0, 0, $c[2], $c[3]), (New-Object System.Drawing.Rectangle $c[0], $c[1], $c[2], $c[3]), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  foreach ($m in $job.masks) {
    $x0 = [Math]::Max(0, $m[0] - $c[0]); $x1 = [Math]::Min($c[2], $m[2] - $c[0])
    $y0 = [Math]::Max(0, $m[1] - $c[1]); $y1 = [Math]::Min($c[3], $m[3] - $c[1])
    for ($y = $y0; $y -lt $y1; $y++) {
      if ($m[4] -eq 'right') {
        $sx = [Math]::Min($c[2] - 1, $x1 + 2)
        $col = $bmp.GetPixel($sx, $y)
        for ($x = $x0; $x -lt $x1; $x++) { $bmp.SetPixel($x, $y, $col) }
      } else {
        $sx = [Math]::Max(0, $x0 - 3)
        $col = $bmp.GetPixel($sx, $y)
        for ($x = $x0; $x -lt $x1; $x++) { $bmp.SetPixel($x, $y, $col) }
      }
    }
  }
  $path = Join-Path $out "$($job.id).jpg"
  $bmp.Save($path, $codec, $ep)
  $bmp.Dispose(); $full.Dispose()
  "{0}: {1:N0} bytes" -f $job.id, (Get-Item $path).Length
}
