const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const POWERSHELL = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
);

const TEMPO_LIMITE_MS = 120000;

class ErroImpressao extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function ehPdf(buffer) {
    return Buffer.isBuffer(buffer)
        && buffer.length >= 5
        && buffer[0] === 0x25
        && buffer[1] === 0x50
        && buffer[2] === 0x44
        && buffer[3] === 0x46;
}

function salvarPdf(buffer) {
    const arquivo = path.join(
        os.tmpdir(),
        `impressao-${crypto.randomBytes(16).toString('hex')}.pdf`
    );
    fs.writeFileSync(arquivo, buffer);
    return arquivo;
}

function decodificarSaida(buffer) {
    if (!buffer || buffer.length === 0) {
        return '';
    }
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return buffer.toString('utf16le').replace(/^\uFEFF/, '');
    }
    if (buffer.length >= 4 && buffer[1] === 0x00 && buffer[3] === 0x00) {
        return buffer.toString('utf16le');
    }
    return buffer.toString('utf8');
}

function executar(script, env) {
    const id = crypto.randomBytes(8).toString('hex');
    const scriptPath = path.join(os.tmpdir(), `impressao-script-${id}.ps1`);
    const resultPath = path.join(os.tmpdir(), `impressao-resultado-${id}.json`);
    fs.writeFileSync(scriptPath, script);

    return new Promise((resolve, reject) => {
        const child = spawn(POWERSHELL, [
            '-NoProfile',
            '-NonInteractive',
            '-STA',
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath
        ], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                ...env,
                RESULT_PATH: resultPath
            }
        });

        const stderrChunks = [];
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, TEMPO_LIMITE_MS);

        child.stderr.on('data', (chunk) => {
            stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            fs.unlink(scriptPath, () => {});
            reject(error);
        });
        child.on('close', () => {
            clearTimeout(timer);
            let payload = null;
            try {
                payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
            } catch (error) {
                payload = null;
            }
            fs.unlink(resultPath, () => {});
            fs.unlink(scriptPath, () => {});
            resolve({
                timedOut,
                payload,
                stderr: decodificarSaida(Buffer.concat(stderrChunks)).trim()
            });
        });
    });
}

function erroDoResultado(payload, stderr) {
    if (!payload) {
        return new ErroImpressao(
            500,
            stderr ? `Falha no spooler: ${stderr}` : 'Falha no spooler'
        );
    }
    if (payload.ok) {
        return null;
    }
    if (payload.code === 'printer') {
        return new ErroImpressao(404, 'Impressora não instalada');
    }
    if (payload.code === 'pdf') {
        return new ErroImpressao(400, 'PDF ausente ou inválido');
    }
    if (payload.code === 'spooler-stopped') {
        return new ErroImpressao(
            500,
            'Falha no spooler: O serviço de spooler do Windows não está em execução.'
        );
    }
    const detalhe = payload.message ? String(payload.message) : '';
    return new ErroImpressao(
        500,
        detalhe ? `Falha no spooler: ${detalhe}` : 'Falha no spooler'
    );
}

const SCRIPT_LISTAR = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Result([bool]$Ok, [string]$Code, [string]$Message, $Names) {
    $dict = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $dict['ok'] = $Ok
    if ($Code) { $dict['code'] = $Code }
    if ($Message) { $dict['message'] = $Message }
    if ($null -ne $Names) { $dict['impressoras'] = $Names }
    Add-Type -AssemblyName System.Web.Extensions
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = 16777216
    $json = $ser.Serialize($dict)
    [System.IO.File]::WriteAllText($env:RESULT_PATH, $json, (New-Object System.Text.UTF8Encoding $false))
}

try {
    $svc = Get-Service -Name Spooler -ErrorAction Stop
    if ($svc.Status -ne 'Running') {
        Write-Result $false 'spooler-stopped' 'stopped' $null
        exit 1
    }
    Add-Type -AssemblyName System.Drawing
    $names = New-Object System.Collections.Generic.List[string]
    foreach ($n in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
        if ($null -ne $n) { [void]$names.Add([string]$n) }
    }
    Write-Result $true '' '' $names.ToArray()
    exit 0
} catch {
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException -and $_.Exception.InnerException.Message) {
        $msg = $_.Exception.InnerException.Message
    }
    Write-Result $false 'spooler' $msg $null
    exit 1
}
`;

const SCRIPT_IMPRIMIR = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Result([bool]$Ok, [string]$Code, [string]$Message) {
    $dict = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $dict['ok'] = $Ok
    if ($Code) { $dict['code'] = $Code }
    if ($Message) { $dict['message'] = $Message }
    Add-Type -AssemblyName System.Web.Extensions
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = 16777216
    $json = $ser.Serialize($dict)
    [System.IO.File]::WriteAllText($env:RESULT_PATH, $json, (New-Object System.Text.UTF8Encoding $false))
}

function Mensagem-Erro($err) {
    $msg = $err.Exception.Message
    if ($err.Exception.InnerException -and $err.Exception.InnerException.Message) {
        $msg = $err.Exception.InnerException.Message
    }
    return $msg
}

try {
    $svc = Get-Service -Name Spooler -ErrorAction Stop
} catch {
    Write-Result $false 'spooler' (Mensagem-Erro $_)
    exit 1
}
if ($svc.Status -ne 'Running') {
    Write-Result $false 'spooler-stopped' 'stopped'
    exit 1
}

$nome = [string]$env:PRINTER_NAME
if ([string]::IsNullOrEmpty($nome)) {
    Write-Result $false 'printer' 'ausente'
    exit 2
}

Add-Type -AssemblyName System.Drawing
$achou = $false
foreach ($n in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
    if ([string]$n -ceq $nome) { $achou = $true; break }
}
if (-not $achou) {
    Write-Result $false 'printer' 'ausente'
    exit 2
}

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.PrinterSettings.PrinterName = $nome
if ($doc.PrinterSettings.PrinterName -cne $nome -or -not $doc.PrinterSettings.IsValid) {
    $doc.Dispose()
    Write-Result $false 'printer' 'ausente'
    exit 2
}

$global:paginas = New-Object System.Collections.Generic.List[object]
$global:indice = 0

try {
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
        $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
        $null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
        $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

        $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
        }) | Select-Object -First 1
        if (-not $asTaskGeneric) { throw 'PDF ausente ou invalido' }

        $asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
        }) | Select-Object -First 1
        if (-not $asTaskAction) { throw 'PDF ausente ou invalido' }

        function Await-Op($op, $type) {
            $method = $asTaskGeneric.MakeGenericMethod($type)
            $task = $method.Invoke($null, @($op))
            $task.Wait()
            if ($task.IsFaulted) { throw $task.Exception.InnerException }
            return $task.Result
        }
        function Await-Action($action) {
            $task = $asTaskAction.Invoke($null, @($action))
            $task.Wait()
            if ($task.IsFaulted) { throw $task.Exception.InnerException }
        }

        if (-not (Test-Path -LiteralPath $env:PDF_PATH)) { throw 'PDF ausente ou invalido' }
        $file = Await-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:PDF_PATH)) ([Windows.Storage.StorageFile])
        $pdf = Await-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
        if ($pdf.PageCount -lt 1) { throw 'PDF ausente ou invalido' }
    } catch {
        Write-Result $false 'pdf' (Mensagem-Erro $_)
        exit 3
    }

    $dpi = 300
    for ($i = 0; $i -lt $pdf.PageCount; $i++) {
        $page = $null
        $bmp = $null
        $flat = $null
        $g = $null
        $net = $null
        $ras = $null
        try {
            $page = $pdf.GetPage([uint32]$i)
            $pxW = [uint32][Math]::Max(1, [Math]::Round($page.Size.Width / 96.0 * $dpi))
            $pxH = [uint32][Math]::Max(1, [Math]::Round($page.Size.Height / 96.0 * $dpi))
            $largura = [int][Math]::Max(1, [Math]::Round($page.Size.Width / 96.0 * 100.0))
            $altura = [int][Math]::Max(1, [Math]::Round($page.Size.Height / 96.0 * 100.0))
            $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
            $opts.DestinationWidth = $pxW
            $opts.DestinationHeight = $pxH
            $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
            Await-Action ($page.RenderToStreamAsync($ras, $opts))
            $ras.Seek(0) | Out-Null
            $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStream($ras)
            $bmp = New-Object System.Drawing.Bitmap($net)
            $flat = New-Object System.Drawing.Bitmap($bmp.Width, $bmp.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
            $g = [System.Drawing.Graphics]::FromImage($flat)
            $g.Clear([System.Drawing.Color]::White)
            $g.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height)
            $global:paginas.Add(@{
                Bitmap = $flat
                Largura = $largura
                Altura = $altura
            })
            $flat = $null
        } finally {
            if ($g) { $g.Dispose() }
            if ($bmp) { $bmp.Dispose() }
            if ($flat) { $flat.Dispose() }
            if ($net) { $net.Dispose() }
            if ($ras) { $ras.Dispose() }
            if ($page) { $page.Dispose() }
        }
    }

    if ($global:paginas.Count -lt 1) { throw 'PDF ausente ou invalido' }
    if ($doc.PrinterSettings.PrinterName -cne $nome) {
        Write-Result $false 'printer' 'ausente'
        exit 2
    }

    $primeira = $global:paginas[0]
    $doc.DocumentName = 'Etiqueta DANFE'
    $doc.OriginAtMargins = $false
    $doc.DefaultPageSettings.Landscape = $false
    $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
    $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('PDF', $primeira.Largura, $primeira.Altura)

    $doc.add_QueryPageSettings({
        param($sender, $e)
        if ($global:indice -lt 0 -or $global:indice -ge $global:paginas.Count) { return }
        $pagina = $global:paginas[$global:indice]
        $e.PageSettings.Landscape = $false
        $e.PageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
        $e.PageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('PDF', $pagina.Largura, $pagina.Altura)
    })

    $doc.add_PrintPage({
        param($sender, $e)
        if ($global:indice -ge $global:paginas.Count) {
            $e.HasMorePages = $false
            return
        }
        $pagina = $global:paginas[$global:indice]
        $e.Graphics.Clear([System.Drawing.Color]::White)
        $bounds = $e.Graphics.VisibleClipBounds
        if ($bounds.Width -le 0 -or $bounds.Height -le 0) { $bounds = $e.PageBounds }
        $imgW = [single]$pagina.Bitmap.Width
        $imgH = [single]$pagina.Bitmap.Height
        $pageW = [single]$bounds.Width
        $pageH = [single]$bounds.Height
        if ($pageW -le 0 -or $pageH -le 0 -or $imgW -le 0 -or $imgH -le 0) {
            throw 'Area de impressao vazia'
        }
        $imgAspect = $imgW / $imgH
        $pageAspect = $pageW / $pageH
        if ($imgAspect -gt $pageAspect) {
            $drawW = $pageW
            $drawH = $pageW / $imgAspect
        } else {
            $drawH = $pageH
            $drawW = $pageH * $imgAspect
        }
        $x = [single]$bounds.X + (($pageW - $drawW) / 2)
        $y = [single]$bounds.Y + (($pageH - $drawH) / 2)
        $rect = New-Object System.Drawing.RectangleF($x, $y, $drawW, $drawH)
        $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $e.Graphics.DrawImage($pagina.Bitmap, $rect)
        $global:indice++
        $e.HasMorePages = ($global:indice -lt $global:paginas.Count)
    })

    $doc.Print()
    Write-Result $true '' ''
    exit 0
} catch {
    Write-Result $false 'spooler' (Mensagem-Erro $_)
    exit 1
} finally {
    if ($global:paginas) {
        foreach ($pagina in $global:paginas) {
            if ($pagina.Bitmap) { $pagina.Bitmap.Dispose() }
        }
    }
    if ($doc) { $doc.Dispose() }
}
`;

async function listarImpressoras() {
    const resultado = await executar(SCRIPT_LISTAR, {});
    if (resultado.timedOut) {
        throw new ErroImpressao(500, 'Falha no spooler: tempo esgotado');
    }
    const erro = erroDoResultado(resultado.payload, resultado.stderr);
    if (erro) {
        throw erro;
    }
    const lista = resultado.payload && resultado.payload.impressoras;
    if (!Array.isArray(lista)) {
        return [];
    }
    return lista.map((nome) => String(nome));
}

async function imprimirPdf(buffer, impressora) {
    if (!ehPdf(buffer)) {
        throw new ErroImpressao(400, 'PDF ausente ou inválido');
    }
    if (typeof impressora !== 'string' || impressora.trim() === '') {
        throw new ErroImpressao(400, 'Impressora não informada');
    }

    const instaladas = await listarImpressoras();
    if (!instaladas.includes(impressora)) {
        throw new ErroImpressao(404, 'Impressora não instalada');
    }

    const arquivo = salvarPdf(buffer);
    try {
        const resultado = await executar(SCRIPT_IMPRIMIR, {
            PDF_PATH: arquivo,
            PRINTER_NAME: impressora
        });
        if (resultado.timedOut) {
            throw new ErroImpressao(500, 'Falha no spooler: tempo esgotado');
        }
        const erro = erroDoResultado(resultado.payload, resultado.stderr);
        if (erro) {
            throw erro;
        }
    } finally {
        try {
            fs.unlinkSync(arquivo);
        } catch (error) {
            // O spooler já recebeu as páginas renderizadas.
        }
    }
}

module.exports = {
    ehPdf,
    salvarPdf,
    listarImpressoras,
    imprimirPdf,
    scripts: {
        listar: SCRIPT_LISTAR,
        imprimir: SCRIPT_IMPRIMIR
    }
};
