Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$ErrorActionPreference = 'Stop'

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $AppDir "data"
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# 싱글 인스턴스 유지 (기존 위젯 PID만 안전하게 종료)
$PidFile = Join-Path $DataDir "widget.pid"
if (Test-Path $PidFile) {
    try {
        $oldPid = [int](Get-Content $PidFile -Raw).Trim()
        if ($oldPid -ne $PID) {
            $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
            if ($oldProc -and $oldProc.ProcessName -like "*powershell*") {
                Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}
}
[System.IO.File]::WriteAllText($PidFile, "$PID")

$DataFile = Join-Path $DataDir "timetable_progress.json"
$PosFile  = Join-Path $DataDir "widget_pos.json"
$HtmlFile = Join-Path $AppDir "수업진도현황_시간표달력.html"
$ServerJs = Join-Path $AppDir "widget-sync-server.js"

# 백그라운드 동기화 서버(widget-sync-server.js) 실행 확인 및 시작
try {
    $nodeExe = "C:\Program Files\nodejs\node.exe"
    if (-not (Test-Path $nodeExe)) {
        $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($cmd) { $nodeExe = $cmd.Source }
    }
    if ((Test-Path $nodeExe) -and (Test-Path $ServerJs)) {
        $existingNode = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*widget-sync-server.js*" }
        if (-not $existingNode) {
            Start-Process -FilePath $nodeExe -ArgumentList "`"$ServerJs`"" -WorkingDirectory $AppDir -WindowStyle Hidden
        }
    }
} catch {}

# 브러시 변환 헬퍼
$BrushConverter = New-Object System.Windows.Media.BrushConverter
function Get-Brush([string]$hex) {
    return $BrushConverter.ConvertFromString($hex)
}

# 반별 색상 테마
$ClassThemes = @{
    '1-1' = @{ bg = '#FEF3C7'; border = '#F59E0B'; badge = '#F59E0B' }
    '1-2' = @{ bg = '#FFEDD5'; border = '#F97316'; badge = '#EA580C' }
    '1-3' = @{ bg = '#FFE4E6'; border = '#FB7185'; badge = '#E11D48' }
    '1-4' = @{ bg = '#FEF9C3'; border = '#EAB308'; badge = '#CA8A04' }
    '1-5' = @{ bg = '#FCE7F3'; border = '#F472B6'; badge = '#DB2777' }
    '1-6' = @{ bg = '#ECFCCB'; border = '#84CC16'; badge = '#65A30D' }
    '1-7' = @{ bg = '#FDE68A'; border = '#D97706'; badge = '#B45309' }
    '2-1' = @{ bg = '#CCFBF1'; border = '#14B8A6'; badge = '#0D9488' }
    '2-2' = @{ bg = '#D1FAE5'; border = '#10B981'; badge = '#059669' }
    '2-3' = @{ bg = '#E0F2FE'; border = '#0EA5E9'; badge = '#0284C7' }
    '2-4' = @{ bg = '#CFFAFE'; border = '#06B6D4'; badge = '#0891B2' }
    '2-5' = @{ bg = '#DBEAFE'; border = '#3B82F6'; badge = '#2563EB' }
    '2-6' = @{ bg = '#E0E7FF'; border = '#6366F1'; badge = '#4F46E5' }
    '2-7' = @{ bg = '#EDE9FE'; border = '#8B5CF6'; badge = '#7C3AED' }
}

# 요일별 기본 시간표
$WeeklySchedule = @{
    1 = @(
        @{ period = 1; className = '1-2'; grade = 1 },
        @{ period = 2; className = '2-7'; grade = 2 },
        @{ period = 4; className = '2-2'; grade = 2 },
        @{ period = 5; className = '1-4'; grade = 1 }
    )
    2 = @(
        @{ period = 2; className = '2-4'; grade = 2 },
        @{ period = 7; className = '2-5'; grade = 2 }
    )
    3 = @(
        @{ period = 3; className = '1-1'; grade = 1 },
        @{ period = 4; className = '1-6'; grade = 1 },
        @{ period = 6; className = '2-3'; grade = 2 }
    )
    4 = @(
        @{ period = 2; className = '2-1'; grade = 2 },
        @{ period = 4; className = '1-5'; grade = 1 },
        @{ period = 7; className = '1-7'; grade = 1 }
    )
    5 = @(
        @{ period = 2; className = '1-3'; grade = 1 },
        @{ period = 3; className = '2-6'; grade = 2 }
    )
}

$StartDate = Get-Date -Year 2026 -Month 10 -Day 19 -Hour 0 -Minute 0 -Second 0
$EndDate   = Get-Date -Year 2026 -Month 12 -Day 31 -Hour 0 -Minute 0 -Second 0

function Get-DefaultWidgetDate {
    $now = (Get-Date).Date
    if ($now -lt $StartDate) { return $StartDate }
    if ($now -gt $EndDate)   { return $EndDate }
    if ($now.DayOfWeek -eq 'Saturday') { $now = $now.AddDays(2) }
    elseif ($now.DayOfWeek -eq 'Sunday') { $now = $now.AddDays(1) }
    if ($now -gt $EndDate) { return $EndDate }
    return $now
}

$script:CurrentDate = Get-DefaultWidgetDate
$script:LastFileWriteTime = [datetime]::MinValue
$script:AppState = $null

function Load-AppState {
    if (Test-Path $DataFile) {
        try {
            $raw = [System.IO.File]::ReadAllText($DataFile, [System.Text.Encoding]::UTF8)
            $script:AppState = $raw | ConvertFrom-Json
            $script:LastFileWriteTime = (Get-Item $DataFile).LastWriteTime
            return
        } catch {}
    }
    $script:AppState = [PSCustomObject]@{
        syllabus = [PSCustomObject]@{ '1' = @(); '2' = @() }
        records = [PSCustomObject]@{}
        classMemos = [PSCustomObject]@{}
        holidays = [PSCustomObject]@{}
        scheduleOverrides = [PSCustomObject]@{}
        addedLessons = @()
        updatedAt = 1
    }
}

function Save-AppState {
    try {
        $nowMs = [int64]([datetime]::UtcNow - [datetime]'1970-01-01').TotalMilliseconds
        if (Test-Path $DataFile) {
            try {
                $diskRaw = [System.IO.File]::ReadAllText($DataFile, [System.Text.Encoding]::UTF8)
                $diskState = $diskRaw | ConvertFrom-Json
                if ($null -ne $diskState -and $null -ne $diskState.records) {
                    foreach ($prop in $diskState.records.PSObject.Properties) {
                        $existing = Get-PropValue $script:AppState.records $prop.Name
                        if ($null -eq $existing) {
                            Set-PropValue $script:AppState.records $prop.Name $prop.Value
                        }
                    }
                }
            } catch {}
        }
        $script:AppState | Add-Member -NotePropertyName "updatedAt" -NotePropertyValue $nowMs -Force
        $json = $script:AppState | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($DataFile, $json, (New-Object System.Text.UTF8Encoding($false)))
        $script:LastFileWriteTime = (Get-Item $DataFile).LastWriteTime
    } catch {}
}

function Get-PropValue($obj, [string]$key) {
    if ($null -eq $obj) { return $null }
    $prop = $obj.PSObject.Properties[$key]
    if ($null -ne $prop) { return $prop.Value }
    return $null
}

function Set-PropValue($obj, [string]$key, $val) {
    $obj | Add-Member -NotePropertyName $key -NotePropertyValue $val -Force
}

function Get-DayLessonsForDate([datetime]$d) {
    $dateStr = $d.ToString("yyyy-MM-dd")
    $dow = [int]$d.DayOfWeek
    $baseList = $WeeklySchedule[$dow]
    if ($null -eq $baseList) { $baseList = @() }

    $active = @()
    $holidayLabel = Get-PropValue $script:AppState.holidays $dateStr
    $isDayHoliday = -not [string]::IsNullOrWhiteSpace($holidayLabel)

    foreach ($item in $baseList) {
        $baseSlotId = "${dateStr}_P$($item.period)_$($item.className)"
        $ov = Get-PropValue $script:AppState.scheduleOverrides $baseSlotId
        if ($null -ne $ov -and $ov.deleted -eq $true) {
            continue
        }
        $effClass = if ($null -ne $ov -and $ov.className) { [string]$ov.className } else { [string]$item.className }
        $effPeriod = if ($null -ne $ov -and $ov.period) { [int]$ov.period } else { [int]$item.period }
        $isMod = ($null -ne $ov -and ($effClass -ne $item.className -or $effPeriod -ne $item.period -or (-not [string]::IsNullOrWhiteSpace($ov.changeNote))))

        $legacyKey = "${dateStr}_${effClass}"
        $recKey = if ($isMod) { "${baseSlotId}__${effClass}" } else { $legacyKey }

        $rec = Get-PropValue $script:AppState.records $recKey
        if ($null -eq $rec -and $isMod) {
            $rec = Get-PropValue $script:AppState.records $legacyKey
        }
        $isSkip = ($null -ne $rec -and $rec.skip -eq $true) -or $isDayHoliday

        $active += [PSCustomObject]@{
            slotType = 'base'
            slotId = $baseSlotId
            recordKey = $recKey
            dateStr = $dateStr
            period = $effPeriod
            className = $effClass
            origPeriod = $item.period
            origClassName = $item.className
            isModified = $isMod
            isAdded = $false
            changeNote = if ($null -ne $ov -and $ov.changeNote) { [string]$ov.changeNote } else { '' }
            isSkipped = $isSkip
        }
    }

    if ($null -ne $script:AppState.addedLessons) {
        foreach ($add in $script:AppState.addedLessons) {
            if ($add.dateStr -eq $dateStr) {
                $recKey = "added_$($add.id)"
                $rec = Get-PropValue $script:AppState.records $recKey
                $isSkip = ($null -ne $rec -and $rec.skip -eq $true) -or $isDayHoliday
                $active += [PSCustomObject]@{
                    slotType = 'added'
                    slotId = $add.id
                    recordKey = $recKey
                    dateStr = $dateStr
                    period = [int]$add.period
                    className = [string]$add.className
                    origPeriod = $null
                    origClassName = $null
                    isModified = $false
                    isAdded = $true
                    changeNote = if ($add.changeNote) { [string]$add.changeNote } else { '추가 수업' }
                    isSkipped = $isSkip
                }
            }
        }
    }

    return ($active | Sort-Object period)
}

function Get-SessionOrdersMap {
    $orders = @{}
    $counts = @{}
    $cur = $StartDate
    while ($cur -le $EndDate) {
        $dow = [int]$cur.DayOfWeek
        if ($dow -ge 1 -and $dow -le 5) {
            $dayLessons = Get-DayLessonsForDate $cur
            foreach ($les in $dayLessons) {
                if (-not $les.isSkipped) {
                    if (-not $counts.ContainsKey($les.className)) { $counts[$les.className] = 0 }
                    $counts[$les.className]++
                    $orders[$les.recordKey] = $counts[$les.className]
                }
            }
        }
        $cur = $cur.AddDays(1)
    }
    return $orders
}

# =========================================================================
# 스마트폰 위젯 스타일 XAML (창 테두리 없음, 배경 투명, 내용에 맞춰 높이 자동 조절)
# =========================================================================
[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="혜정샘 오늘의 수업 위젯"
        Width="345"
        SizeToContent="Height"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        ShowInTaskbar="False"
        Topmost="False"
        ResizeMode="NoResize"
        FontFamily="Pretendard, Malgun Gothic, Segoe UI">
    <Grid Margin="10">
        <Grid.Effect>
            <DropShadowEffect BlurRadius="16" ShadowDepth="4" Direction="270" Color="#0F172A" Opacity="0.18"/>
        </Grid.Effect>
        <StackPanel>
            <!-- 1. 상단 요일 바 (드래그 이동 가능 + 이전/다음 요일 + 전체 달력 열기) -->
            <Border x:Name="TopDragBar" Background="#1E293B" CornerRadius="13" Padding="10,9" Margin="0,0,0,8" Cursor="SizeAll">
                <Grid>
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="Auto"/>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    <StackPanel Grid.Column="0" Orientation="Horizontal">
                        <Button x:Name="PrevDayBtn" Content="◀" Width="25" Height="25" Background="#334155" Foreground="White" BorderThickness="0" FontWeight="Bold" Cursor="Hand" ToolTip="이전 수업일">
                            <Button.Resources>
                                <Style TargetType="Border"><Setter Property="CornerRadius" Value="7"/></Style>
                            </Button.Resources>
                        </Button>
                    </StackPanel>

                    <TextBlock x:Name="WeekdayHeaderText" Grid.Column="1" Text="화요일 (TUE)" Foreground="White" FontWeight="ExtraBold" FontSize="15" HorizontalAlignment="Center" VerticalAlignment="Center"/>

                    <StackPanel Grid.Column="2" Orientation="Horizontal">
                        <Button x:Name="NextDayBtn" Content="▶" Width="25" Height="25" Background="#334155" Foreground="White" BorderThickness="0" FontWeight="Bold" Cursor="Hand" Margin="0,0,4,0" ToolTip="다음 수업일">
                            <Button.Resources>
                                <Style TargetType="Border"><Setter Property="CornerRadius" Value="7"/></Style>
                            </Button.Resources>
                        </Button>
                        <Button x:Name="PinTopBtn" Content="📌" Width="25" Height="25" Background="#334155" Foreground="White" BorderThickness="0" FontSize="11" Cursor="Hand" Margin="0,0,4,0" ToolTip="항상 위에 고정 켜기/끄기">
                            <Button.Resources>
                                <Style TargetType="Border"><Setter Property="CornerRadius" Value="7"/></Style>
                            </Button.Resources>
                        </Button>
                        <Button x:Name="CloseWidgetBtn" Content="✕" Width="25" Height="25" Background="#334155" Foreground="#CBD5E1" BorderThickness="0" FontSize="11" FontWeight="Bold" Cursor="Hand" ToolTip="위젯 닫기">
                            <Button.Resources>
                                <Style TargetType="Border"><Setter Property="CornerRadius" Value="7"/></Style>
                            </Button.Resources>
                        </Button>
                    </StackPanel>
                </Grid>
            </Border>

            <!-- 2. 메인 날짜 수업 카드 (내용 길이에 맞춰 높이 자동 조절) -->
            <Border Background="#FFFFFF" BorderBrush="#4F46E5" BorderThickness="2" CornerRadius="16" Padding="13">
                <StackPanel>
                    <!-- 날짜 & 상단 액션 버튼 줄 -->
                    <Grid Margin="0,0,0,8">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*"/>
                            <ColumnDefinition Width="Auto"/>
                        </Grid.ColumnDefinitions>

                        <StackPanel Grid.Column="0" Orientation="Horizontal" VerticalAlignment="Center">
                            <TextBlock x:Name="DateTitleText" Text="10/20(화)" FontSize="15.5" FontWeight="ExtraBold" Foreground="#1E293B" VerticalAlignment="Center" Margin="0,0,6,0"/>
                            <Border x:Name="TodayBadge" Background="#4F46E5" CornerRadius="9" Padding="7,2" VerticalAlignment="Center">
                                <TextBlock x:Name="TodayBadgeText" Text="오늘" Foreground="White" FontSize="10.5" FontWeight="Bold"/>
                            </Border>
                            <Button x:Name="GoTodayBtn" Content="오늘로" Visibility="Collapsed" Background="#EEF2FF" Foreground="#4F46E5" BorderBrush="#C7D2FE" BorderThickness="1" FontSize="10.5" FontWeight="Bold" Padding="6,2" Cursor="Hand" Margin="2,0,0,0">
                                <Button.Resources>
                                    <Style TargetType="Border"><Setter Property="CornerRadius" Value="7"/></Style>
                                </Button.Resources>
                            </Button>
                        </StackPanel>

                        <StackPanel Grid.Column="1" Orientation="Horizontal" VerticalAlignment="Center">
                            <Button x:Name="OpenCalendarBtn" Content="📅 전체달력" Background="#EEF2FF" Foreground="#4F46E5" BorderBrush="#C7D2FE" BorderThickness="1" FontSize="11" FontWeight="Bold" Padding="7,3" Cursor="Hand" Margin="0,0,4,0" ToolTip="전체 수업 진도 달력을 엽니다">
                                <Button.Resources>
                                    <Style TargetType="Border"><Setter Property="CornerRadius" Value="7"/></Style>
                                </Button.Resources>
                            </Button>
                            <Button x:Name="ToggleHolidayBtn" Content="🏖️ 휴일" Background="#F8FAFC" Foreground="#475569" BorderBrush="#E2E8F0" BorderThickness="1" FontSize="11" FontWeight="Bold" Padding="7,3" Cursor="Hand" ToolTip="이 날을 휴일로 지정/해제합니다">
                                <Button.Resources>
                                    <Style TargetType="Border"><Setter Property="CornerRadius" Value="7"/></Style>
                                </Button.Resources>
                            </Button>
                        </StackPanel>
                    </Grid>

                    <!-- 구분선 -->
                    <Border Height="1" Background="#F1F5F9" Margin="0,0,0,9"/>

                    <!-- 수업 카드들이 동적으로 들어갈 컨테이너 -->
                    <StackPanel x:Name="LessonsContainer"/>
                </StackPanel>
            </Border>
        </StackPanel>
    </Grid>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

$TopDragBar        = $window.FindName("TopDragBar")
$PrevDayBtn        = $window.FindName("PrevDayBtn")
$NextDayBtn        = $window.FindName("NextDayBtn")
$PinTopBtn         = $window.FindName("PinTopBtn")
$CloseWidgetBtn    = $window.FindName("CloseWidgetBtn")
$WeekdayHeaderText = $window.FindName("WeekdayHeaderText")
$DateTitleText     = $window.FindName("DateTitleText")
$TodayBadge        = $window.FindName("TodayBadge")
$GoTodayBtn        = $window.FindName("GoTodayBtn")
$OpenCalendarBtn   = $window.FindName("OpenCalendarBtn")
$ToggleHolidayBtn  = $window.FindName("ToggleHolidayBtn")
$LessonsContainer  = $window.FindName("LessonsContainer")

# 저장된 위젯 위치 불러오기 (없으면 바탕화면 오른쪽 상단에 배치)
$screenWidth = [System.Windows.SystemParameters]::WorkArea.Width
$window.Left = $screenWidth - 365
$window.Top  = 35

if (Test-Path $PosFile) {
    try {
        $pos = Get-Content $PosFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $pos.left -and $null -ne $pos.top) {
            if ($pos.left -ge 0 -and $pos.left -lt ($screenWidth - 100)) {
                $window.Left = [double]$pos.left
                $window.Top  = [double]$pos.top
            }
        }
        if ($null -ne $pos.topmost) {
            $window.Topmost = [bool]$pos.topmost
            $PinTopBtn.Background = if ($window.Topmost) { Get-Brush '#4F46E5' } else { Get-Brush '#334155' }
        }
    } catch {}
}

function Save-WidgetPosition {
    try {
        $posObj = @{
            left = [math]::Round($window.Left)
            top  = [math]::Round($window.Top)
            topmost = $window.Topmost
        } | ConvertTo-Json
        [System.IO.File]::WriteAllText($PosFile, $posObj, (New-Object System.Text.UTF8Encoding($false)))
    } catch {}
}

# 드래그로 위젯 이동
$TopDragBar.Add_MouseLeftButtonDown({
    if ($_.ButtonState -eq 'Pressed') {
        $window.DragMove()
        Save-WidgetPosition
    }
})

# 빠른 진도/결시생 수정 미니 팝업창
function Open-QuickEditDialog($lessonObj) {
    $rec = Get-PropValue $script:AppState.records $lessonObj.recordKey
    if ($null -eq $rec) {
        $rec = [PSCustomObject]@{ category = '수업'; topic = ''; content = ''; absent = ''; note = ''; done = $false; skip = $false }
    }

    $grade = if ($lessonObj.className.StartsWith('1-')) { '1' } else { '2' }
    $syllabusList = Get-PropValue $script:AppState.syllabus $grade

    [xml]$dlgXaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="$($lessonObj.className)반 수업 기록 수정"
        Width="380" SizeToContent="Height"
        WindowStartupLocation="CenterOwner"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        FontFamily="Pretendard, Malgun Gothic, Segoe UI">
    <Border Margin="10" Background="White" BorderBrush="#4F46E5" BorderThickness="2" CornerRadius="14" Padding="15">
        <Border.Effect>
            <DropShadowEffect BlurRadius="14" ShadowDepth="3" Color="#0F172A" Opacity="0.22"/>
        </Border.Effect>
        <StackPanel>
            <TextBlock Text="✏️ $($lessonObj.dateStr) ($($lessonObj.period)교시 $($lessonObj.className)반)" FontWeight="ExtraBold" FontSize="15" Foreground="#1E293B" Margin="0,0,0,10"/>

            <TextBlock Text="1. 분류 선택 (수업 / 평가 / 기타)" FontWeight="Bold" FontSize="12" Foreground="#475569" Margin="0,0,0,4"/>
            <ComboBox x:Name="CatCombo" SelectedIndex="0" Padding="6,5" Margin="0,0,0,8" FontWeight="Bold">
                <ComboBoxItem Content="📘 수업" Tag="수업"/>
                <ComboBoxItem Content="🚨 평가 (강조)" Tag="평가"/>
                <ComboBoxItem Content="📌 기타" Tag="기타"/>
            </ComboBox>

            <TextBlock Text="2. ${grade}학년 진도표에서 빠른 선택" FontWeight="Bold" FontSize="12" Foreground="#475569" Margin="0,0,0,4"/>
            <ComboBox x:Name="SylCombo" Padding="6,5" Margin="0,0,0,8"/>

            <TextBlock Text="3. 수업 진도 / 단원명 (직접 입력 가능)" FontWeight="Bold" FontSize="12" Foreground="#475569" Margin="0,0,0,4"/>
            <TextBox x:Name="TopicBox" Padding="7,6" Margin="0,0,0,8" FontSize="13" FontWeight="Bold"/>

            <TextBlock Text="4. 📝 세부 수업 내용 / 활동 메모" FontWeight="Bold" FontSize="12" Foreground="#475569" Margin="0,0,0,4"/>
            <TextBox x:Name="ContentBox" Padding="7,5" Margin="0,0,0,8" FontSize="12.5" AcceptsReturn="True" TextWrapping="Wrap" MinHeight="42"/>

            <TextBlock Text="5. 🙋‍♀️ 결시생 현황" FontWeight="Bold" FontSize="12" Foreground="#B91C1C" Margin="0,0,0,4"/>
            <TextBox x:Name="AbsentBox" Padding="7,5" Margin="0,0,0,8" FontSize="12.5"/>

            <TextBlock Text="6. ⭐ 특이사항 / 메모" FontWeight="Bold" FontSize="12" Foreground="#B45309" Margin="0,0,0,4"/>
            <TextBox x:Name="NoteBox" Padding="7,5" Margin="0,0,0,10" FontSize="12.5"/>

            <CheckBox x:Name="DoneCheck" Content="✅ 이 시간 수업 완료 체크" FontWeight="Bold" Margin="0,0,0,12"/>

            <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="CancelBtn" Content="취소" Width="70" Height="30" Background="#F1F5F9" Foreground="#334155" BorderThickness="0" FontWeight="Bold" Margin="0,0,6,0" Cursor="Hand"/>
                <Button x:Name="SaveBtn" Content="💾 저장" Width="85" Height="30" Background="#4F46E5" Foreground="White" BorderThickness="0" FontWeight="Bold" Cursor="Hand"/>
            </StackPanel>
        </StackPanel>
    </Border>
</Window>
"@
    $dlgReader = New-Object System.Xml.XmlNodeReader $dlgXaml
    $dlg = [Windows.Markup.XamlReader]::Load($dlgReader)
    $dlg.Owner = $window

    $CatCombo   = $dlg.FindName("CatCombo")
    $SylCombo   = $dlg.FindName("SylCombo")
    $TopicBox   = $dlg.FindName("TopicBox")
    $ContentBox = $dlg.FindName("ContentBox")
    $AbsentBox  = $dlg.FindName("AbsentBox")
    $NoteBox    = $dlg.FindName("NoteBox")
    $DoneCheck  = $dlg.FindName("DoneCheck")
    $CancelBtn  = $dlg.FindName("CancelBtn")
    $SaveBtn    = $dlg.FindName("SaveBtn")

    $curCat = if ($rec.category) { [string]$rec.category } else { '수업' }
    if ($curCat -eq '평가') { $CatCombo.SelectedIndex = 1 }
    elseif ($curCat -eq '기타') { $CatCombo.SelectedIndex = 2 }
    else { $CatCombo.SelectedIndex = 0 }

    $placeholderItem = New-Object System.Windows.Controls.ComboBoxItem
    $placeholderItem.Content = "-- 진도표에서 클릭하여 선택 --"
    $placeholderItem.Tag = $null
    $SylCombo.Items.Add($placeholderItem) | Out-Null
    $SylCombo.SelectedIndex = 0

    if ($null -ne $syllabusList) {
        foreach ($sItem in $syllabusList) {
            $cbItem = New-Object System.Windows.Controls.ComboBoxItem
            $sCat = if ($sItem.category) { $sItem.category } else { '수업' }
            $sTitle = if ($sItem.title) { $sItem.title } else { [string]$sItem }
            $cbItem.Content = "[$sCat] $sTitle"
            $cbItem.Tag = [PSCustomObject]@{ category = $sCat; title = $sTitle }
            $SylCombo.Items.Add($cbItem) | Out-Null
        }
    }

    $SylCombo.Add_SelectionChanged({
        $sel = $SylCombo.SelectedItem
        if ($null -ne $sel -and $null -ne $sel.Tag) {
            $TopicBox.Text = $sel.Tag.title
            if ($sel.Tag.category -eq '평가') { $CatCombo.SelectedIndex = 1 }
            elseif ($sel.Tag.category -eq '기타') { $CatCombo.SelectedIndex = 2 }
            else { $CatCombo.SelectedIndex = 0 }
        }
    })

    $TopicBox.Text   = [string]$rec.topic
    $ContentBox.Text = [string]$rec.content
    $AbsentBox.Text  = [string]$rec.absent
    $NoteBox.Text    = [string]$rec.note
    $DoneCheck.IsChecked = ($rec.done -eq $true)

    $CancelBtn.Add_Click({ $dlg.Close() })
    $SaveBtn.Add_Click({
        $selCatItem = $CatCombo.SelectedItem
        $chosenCat = if ($null -ne $selCatItem -and $selCatItem.Tag) { [string]$selCatItem.Tag } else { '수업' }
        $nowMs = [int64]([datetime]::UtcNow - [datetime]'1970-01-01').TotalMilliseconds
        $newRec = [PSCustomObject]@{
            category   = $chosenCat
            topic      = $TopicBox.Text.Trim()
            content    = $ContentBox.Text.Trim()
            absent     = $AbsentBox.Text.Trim()
            note       = $NoteBox.Text.Trim()
            done       = [bool]$DoneCheck.IsChecked
            skip       = [bool]($rec.skip -eq $true)
            _updatedAt = $nowMs
        }
        Set-PropValue $script:AppState.records $lessonObj.recordKey $newRec
        Save-AppState
        Render-Widget
        $dlg.Close()
    })

    $dlg.ShowDialog() | Out-Null
}

# =========================================================================
# 위젯 화면 렌더링 함수 (해당 날짜의 수업 수에 맞춰 자동으로 카드 생성 및 높이 조절)
# =========================================================================
function Render-Widget {
    $dateStr = $script:CurrentDate.ToString("yyyy-MM-dd")
    $todayStr = (Get-Date).ToString("yyyy-MM-dd")
    $isToday = ($dateStr -eq $todayStr)

    $dowNamesKor = @('일','월','화','수','목','금','토')
    $dowNamesEng = @('SUN','MON','TUE','WED','THU','FRI','SAT')
    $dowIdx = [int]$script:CurrentDate.DayOfWeek
    $korDay = $dowNamesKor[$dowIdx]
    $engDay = $dowNamesEng[$dowIdx]

    $WeekdayHeaderText.Text = "${korDay}요일 ($engDay)"
    $DateTitleText.Text = "$($script:CurrentDate.Month)/$($script:CurrentDate.Day)($korDay)"

    if ($isToday) {
        $TodayBadge.Visibility = 'Visible'
        $GoTodayBtn.Visibility = 'Collapsed'
    } else {
        $TodayBadge.Visibility = 'Collapsed'
        $GoTodayBtn.Visibility = 'Visible'
    }

    $holidayLabel = Get-PropValue $script:AppState.holidays $dateStr
    $isDayHoliday = -not [string]::IsNullOrWhiteSpace($holidayLabel)
    $ToggleHolidayBtn.Content = if ($isDayHoliday) { "🔄 휴일해제" } else { "🏖️ 휴일" }

    $LessonsContainer.Children.Clear()

    if ($isDayHoliday) {
        $hBorder = New-Object System.Windows.Controls.Border
        $hBorder.Background = Get-Brush "#F1F5F9"
        $hBorder.BorderBrush = Get-Brush "#94A3B8"
        $hBorder.BorderThickness = New-Object System.Windows.Thickness(1)
        $hBorder.CornerRadius = New-Object System.Windows.CornerRadius(10)
        $hBorder.Padding = New-Object System.Windows.Thickness(12)
        $hBorder.Margin = New-Object System.Windows.Thickness(0,0,0,6)

        $hText = New-Object System.Windows.Controls.TextBlock
        $hText.Text = "🚩 $holidayLabel (전체 휴강)"
        $hText.Foreground = Get-Brush "#475569"
        $hText.FontWeight = "Bold"
        $hText.FontSize = 12.5
        $hText.HorizontalAlignment = "Center"
        $hBorder.Child = $hText
        $LessonsContainer.Children.Add($hBorder) | Out-Null
    }

    $dayLessons = Get-DayLessonsForDate $script:CurrentDate
    $sessionOrders = Get-SessionOrdersMap

    if ($dayLessons.Count -eq 0 -and -not $isDayHoliday) {
        $emptyText = New-Object System.Windows.Controls.TextBlock
        $emptyText.Text = "이 날짜에 배정된 수업이 없습니다."
        $emptyText.Foreground = Get-Brush "#94A3B8"
        $emptyText.FontSize = 12.5
        $emptyText.HorizontalAlignment = "Center"
        $emptyText.Margin = New-Object System.Windows.Thickness(0,12,0,12)
        $LessonsContainer.Children.Add($emptyText) | Out-Null
        return
    }

    for ($i = 0; $i -lt $dayLessons.Count; $i++) {
        $les = $dayLessons[$i]
        $rec = Get-PropValue $script:AppState.records $les.recordKey
        if ($null -eq $rec) {
            $rec = [PSCustomObject]@{ category = '수업'; topic = ''; content = ''; absent = ''; note = ''; done = $false; skip = $false }
        }

        $theme = $ClassThemes[$les.className]
        if ($null -eq $theme) {
            $theme = @{ bg = '#F1F5F9'; border = '#94A3B8'; badge = '#475569' }
        }

        $hasTopic = -not [string]::IsNullOrWhiteSpace($rec.topic)
        $cat = if ($rec.category) { [string]$rec.category } elseif ($hasTopic -and $rec.topic.Contains('평가')) { '평가' } else { '수업' }
        $isEval = (-not $les.isSkipped) -and $hasTopic -and ($cat -eq '평가' -or $rec.topic.Contains('평가'))

        # 수업 카드 외곽 Border
        $cardBorder = New-Object System.Windows.Controls.Border
        $cardBorder.Background = if ($les.isSkipped) { Get-Brush "#F8FAFC" } else { Get-Brush $theme.bg }
        $cardBorder.BorderBrush = if ($isEval) { Get-Brush "#E11D48" } else { Get-Brush $theme.border }
        $cardBorder.BorderThickness = if ($isEval) { New-Object System.Windows.Thickness(2.5) } else { New-Object System.Windows.Thickness(2) }
        $cardBorder.CornerRadius = New-Object System.Windows.CornerRadius(12)
        $cardBorder.Padding = New-Object System.Windows.Thickness(10, 9, 10, 9)
        $bottomMargin = if ($i -eq ($dayLessons.Count - 1)) { 0 } else { 9 }
        $cardBorder.Margin = New-Object System.Windows.Thickness(0, 0, 0, $bottomMargin)
        $cardBorder.Cursor = [System.Windows.Input.Cursors]::Hand
        $cardBorder.Tag = $les

        $cardStack = New-Object System.Windows.Controls.StackPanel

        # 🚨 평가 강조 배너
        if ($isEval) {
            $evalBanner = New-Object System.Windows.Controls.Border
            $evalBanner.Background = Get-Brush "#E11D48"
            $evalBanner.CornerRadius = New-Object System.Windows.CornerRadius(6)
            $evalBanner.Padding = New-Object System.Windows.Thickness(8, 3, 8, 3)
            $evalBanner.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)

            $evalText = New-Object System.Windows.Controls.TextBlock
            $evalText.Text = "🚨 평가 실시일 ($($les.className)반) · 중요!"
            $evalText.Foreground = Get-Brush "#FFFFFF"
            $evalText.FontWeight = "ExtraBold"
            $evalText.FontSize = 11
            $evalBanner.Child = $evalText
            $cardStack.Children.Add($evalBanner) | Out-Null
        }

        # 상단 줄: [2교시] [2-4] [📘 수업] ... [1차시]
        $headGrid = New-Object System.Windows.Controls.Grid
        $headGrid.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)
        $c1 = New-Object System.Windows.Controls.ColumnDefinition; $c1.Width = "*"
        $c2 = New-Object System.Windows.Controls.ColumnDefinition; $c2.Width = "Auto"
        $headGrid.ColumnDefinitions.Add($c1)
        $headGrid.ColumnDefinitions.Add($c2)

        $leftWrap = New-Object System.Windows.Controls.WrapPanel
        $leftWrap.VerticalAlignment = "Center"

        # 교시 배지
        $pBorder = New-Object System.Windows.Controls.Border
        $pBorder.Background = Get-Brush "#180F172A"
        $pBorder.CornerRadius = New-Object System.Windows.CornerRadius(6)
        $pBorder.Padding = New-Object System.Windows.Thickness(7, 2, 7, 2)
        $pBorder.Margin = New-Object System.Windows.Thickness(0, 0, 5, 0)
        $pBorder.VerticalAlignment = "Center"
        $pText = New-Object System.Windows.Controls.TextBlock
        $pText.Text = "$($les.period)교시"
        $pText.FontSize = 11.5
        $pText.FontWeight = "ExtraBold"
        $pText.Foreground = Get-Brush "#1E293B"
        $pBorder.Child = $pText
        $leftWrap.Children.Add($pBorder) | Out-Null

        # 학급 배지 (예: 2-4)
        $clsBorder = New-Object System.Windows.Controls.Border
        $clsBorder.Background = Get-Brush $theme.badge
        $clsBorder.CornerRadius = New-Object System.Windows.CornerRadius(7)
        $clsBorder.Padding = New-Object System.Windows.Thickness(9, 2, 9, 2)
        $clsBorder.Margin = New-Object System.Windows.Thickness(0, 0, 5, 0)
        $clsBorder.VerticalAlignment = "Center"
        $clsText = New-Object System.Windows.Controls.TextBlock
        $clsText.Text = $les.className
        $clsText.FontSize = 14
        $clsText.FontWeight = "ExtraBold"
        $clsText.Foreground = Get-Brush "#FFFFFF"
        $clsBorder.Child = $clsText
        $leftWrap.Children.Add($clsBorder) | Out-Null

        # 대분류 배지 (📘 수업 / 🚨 평가 / 📌 기타)
        if ($hasTopic -and -not $les.isSkipped) {
            $catBorder = New-Object System.Windows.Controls.Border
            $catBorder.CornerRadius = New-Object System.Windows.CornerRadius(6)
            $catBorder.Padding = New-Object System.Windows.Thickness(6, 2, 6, 2)
            $catBorder.Margin = New-Object System.Windows.Thickness(0, 0, 5, 0)
            $catBorder.VerticalAlignment = "Center"
            $catBorder.BorderThickness = New-Object System.Windows.Thickness(1)

            $catText = New-Object System.Windows.Controls.TextBlock
            $catText.FontSize = 11
            $catText.FontWeight = "ExtraBold"

            if ($cat -eq '평가') {
                $catBorder.Background = Get-Brush "#E11D48"
                $catBorder.BorderBrush = Get-Brush "#BE123C"
                $catText.Foreground = Get-Brush "#FFFFFF"
                $catText.Text = "🚨 평가"
            } elseif ($cat -eq '기타') {
                $catBorder.Background = Get-Brush "#F3E8FF"
                $catBorder.BorderBrush = Get-Brush "#D8B4FE"
                $catText.Foreground = Get-Brush "#6B21A8"
                $catText.Text = "📌 기타"
            } else {
                $catBorder.Background = Get-Brush "#DBEAFE"
                $catBorder.BorderBrush = Get-Brush "#93C5FD"
                $catText.Foreground = Get-Brush "#1E40AF"
                $catText.Text = "📘 수업"
            }
            $catBorder.Child = $catText
            $leftWrap.Children.Add($catBorder) | Out-Null
        }

        if ($les.isAdded) {
            $addBadge = New-Object System.Windows.Controls.Border
            $addBadge.Background = Get-Brush "#0F766E"
            $addBadge.CornerRadius = New-Object System.Windows.CornerRadius(5)
            $addBadge.Padding = New-Object System.Windows.Thickness(5, 2, 5, 2)
            $addBadge.VerticalAlignment = "Center"
            $addTxt = New-Object System.Windows.Controls.TextBlock
            $addTxt.Text = "➕추가"
            $addTxt.Foreground = Get-Brush "#FFFFFF"
            $addTxt.FontSize = 10
            $addTxt.FontWeight = "Bold"
            $addBadge.Child = $addTxt
            $leftWrap.Children.Add($addBadge) | Out-Null
        } elseif ($les.isModified) {
            $modBadge = New-Object System.Windows.Controls.Border
            $modBadge.Background = Get-Brush "#312E81"
            $modBadge.CornerRadius = New-Object System.Windows.CornerRadius(5)
            $modBadge.Padding = New-Object System.Windows.Thickness(5, 2, 5, 2)
            $modBadge.VerticalAlignment = "Center"
            $modTxt = New-Object System.Windows.Controls.TextBlock
            $modTxt.Text = "🔄교체"
            $modTxt.Foreground = Get-Brush "#FFFFFF"
            $modTxt.FontSize = 10
            $modTxt.FontWeight = "Bold"
            $modBadge.Child = $modTxt
            $leftWrap.Children.Add($modBadge) | Out-Null
        }

        [System.Windows.Controls.Grid]::SetColumn($leftWrap, 0)
        $headGrid.Children.Add($leftWrap) | Out-Null

        # 우측 차시 배지 (예: 1차시)
        $orderBorder = New-Object System.Windows.Controls.Border
        $orderBorder.Background = Get-Brush "#CCFFFFFF"
        $orderBorder.CornerRadius = New-Object System.Windows.CornerRadius(9)
        $orderBorder.Padding = New-Object System.Windows.Thickness(7, 2, 7, 2)
        $orderBorder.VerticalAlignment = "Center"
        $orderText = New-Object System.Windows.Controls.TextBlock
        $orderNum = $sessionOrders[$les.recordKey]
        $orderText.Text = if ($les.isSkipped) { "휴강" } elseif ($orderNum) { "${orderNum}차시" } else { "" }
        $orderText.FontSize = 11.5
        $orderText.FontWeight = "Bold"
        $orderText.Foreground = Get-Brush "#475569"
        $orderBorder.Child = $orderText
        [System.Windows.Controls.Grid]::SetColumn($orderBorder, 1)
        $headGrid.Children.Add($orderBorder) | Out-Null

        $cardStack.Children.Add($headGrid) | Out-Null

        # 진도 주제 흰색 박스 + 우측 완료 체크 버튼
        $topicBorder = New-Object System.Windows.Controls.Border
        $topicBorder.Background = if ($isEval) { Get-Brush "#FFF1F2" } else { Get-Brush "#E6FFFFFF" }
        $topicBorder.BorderBrush = if ($isEval) { Get-Brush "#FDA4AF" } else { Get-Brush "#150F172A" }
        $topicBorder.BorderThickness = New-Object System.Windows.Thickness(1)
        $topicBorder.CornerRadius = New-Object System.Windows.CornerRadius(8)
        $topicBorder.Padding = New-Object System.Windows.Thickness(9, 6, 9, 6)

        $topicGrid = New-Object System.Windows.Controls.Grid
        $tc1 = New-Object System.Windows.Controls.ColumnDefinition; $tc1.Width = "*"
        $tc2 = New-Object System.Windows.Controls.ColumnDefinition; $tc2.Width = "Auto"
        $topicGrid.ColumnDefinitions.Add($tc1)
        $topicGrid.ColumnDefinitions.Add($tc2)

        $topicText = New-Object System.Windows.Controls.TextBlock
        $topicText.Text = if ($les.isSkipped) { "🚫 수업 없음 (휴강/행사)" } elseif ($hasTopic) { [string]$rec.topic } else { "+ 클릭하여 수업 진도 선택/입력" }
        $topicText.FontSize = 13
        $topicText.FontWeight = if ($hasTopic) { "ExtraBold" } else { "Medium" }
        $topicText.Foreground = if (-not $hasTopic) { Get-Brush "#94A3B8" } elseif ($isEval) { Get-Brush "#9F1239" } else { Get-Brush "#0F172A" }
        $topicText.TextWrapping = "Wrap"
        $topicText.VerticalAlignment = "Center"
        [System.Windows.Controls.Grid]::SetColumn($topicText, 0)
        $topicGrid.Children.Add($topicText) | Out-Null

        if (-not $les.isSkipped) {
            $doneBtn = New-Object System.Windows.Controls.Button
            $doneBtn.Width = 22
            $doneBtn.Height = 22
            $doneBtn.Margin = New-Object System.Windows.Thickness(6, 0, 0, 0)
            $doneBtn.BorderThickness = New-Object System.Windows.Thickness(1.5)
            $doneBtn.Cursor = [System.Windows.Input.Cursors]::Hand
            $doneBtn.Tag = $les.recordKey
            $doneBtn.ToolTip = "클릭하여 수업 완료 체크/해제"

            if ($rec.done -eq $true) {
                $doneBtn.Background = Get-Brush "#10B981"
                $doneBtn.BorderBrush = Get-Brush "#059669"
                $doneBtn.Foreground = Get-Brush "#FFFFFF"
                $doneBtn.Content = "✓"
                $doneBtn.FontWeight = "ExtraBold"
            } else {
                $doneBtn.Background = Get-Brush "#FFFFFF"
                $doneBtn.BorderBrush = Get-Brush "#CBD5E1"
                $doneBtn.Foreground = Get-Brush "Transparent"
                $doneBtn.Content = ""
            }

            $doneBtn.Add_Click({
                param($sender, $e)
                $e.Handled = $true
                $rKey = [string]$sender.Tag
                $nowMs = [int64]([datetime]::UtcNow - [datetime]'1970-01-01').TotalMilliseconds
                $curRec = Get-PropValue $script:AppState.records $rKey
                if ($null -eq $curRec) {
                    $curRec = [PSCustomObject]@{ category = '수업'; topic = ''; content = ''; absent = ''; note = ''; done = $true; skip = $false; _updatedAt = $nowMs }
                } else {
                    $curRec.done = -not ($curRec.done -eq $true)
                    $curRec | Add-Member -NotePropertyName "_updatedAt" -NotePropertyValue $nowMs -Force
                }
                Set-PropValue $script:AppState.records $rKey $curRec
                Save-AppState
                Render-Widget
            })

            [System.Windows.Controls.Grid]::SetColumn($doneBtn, 1)
            $topicGrid.Children.Add($doneBtn) | Out-Null
        }

        $topicBorder.Child = $topicGrid
        $cardStack.Children.Add($topicBorder) | Out-Null

        # 교체/추가 사유, 세부 수업 내용, 결시생, 특이사항 표시
        $hasChangeInfo = ($les.isModified -or $les.isAdded) -and (-not [string]::IsNullOrWhiteSpace($les.changeNote) -or ($les.isModified -and $les.origClassName -ne $les.className))
        $hasContent    = -not [string]::IsNullOrWhiteSpace($rec.content)
        $hasAbsent     = -not [string]::IsNullOrWhiteSpace($rec.absent)
        $hasNote       = -not [string]::IsNullOrWhiteSpace($rec.note)

        if ($hasChangeInfo -or $hasContent -or $hasAbsent -or $hasNote) {
            $metaWrap = New-Object System.Windows.Controls.WrapPanel
            $metaWrap.Margin = New-Object System.Windows.Thickness(0, 5, 0, 0)

            if ($hasChangeInfo) {
                $chBorder = New-Object System.Windows.Controls.Border
                $chBorder.Background = if ($les.isAdded) { Get-Brush "#CCFBF1" } else { Get-Brush "#E0E7FF" }
                $chBorder.CornerRadius = New-Object System.Windows.CornerRadius(6)
                $chBorder.Padding = New-Object System.Windows.Thickness(6, 2, 6, 2)
                $chBorder.Margin = New-Object System.Windows.Thickness(0, 0, 4, 2)
                $chTxt = New-Object System.Windows.Controls.TextBlock
                $origLabel = if ($les.isModified -and $les.origClassName -ne $les.className) { "기존 $($les.origPeriod)교시 $($les.origClassName) → " } else { "" }
                $notePart  = if (-not [string]::IsNullOrWhiteSpace($les.changeNote)) { $les.changeNote } else { "수업 변경" }
                $chTxt.Text = if ($les.isAdded) { "➕ $notePart" } else { "🔄 ${origLabel}${notePart}" }
                $chTxt.FontSize = 11
                $chTxt.FontWeight = "Bold"
                $chTxt.Foreground = if ($les.isAdded) { Get-Brush "#0F766E" } else { Get-Brush "#312E81" }
                $chTxt.TextWrapping = "Wrap"
                $chBorder.Child = $chTxt
                $metaWrap.Children.Add($chBorder) | Out-Null
            }
            if ($hasContent) {
                $ctBorder = New-Object System.Windows.Controls.Border
                $ctBorder.Background = Get-Brush "#E6FFFFFF"
                $ctBorder.CornerRadius = New-Object System.Windows.CornerRadius(6)
                $ctBorder.Padding = New-Object System.Windows.Thickness(6, 2, 6, 2)
                $ctBorder.Margin = New-Object System.Windows.Thickness(0, 0, 4, 2)
                $ctTxt = New-Object System.Windows.Controls.TextBlock
                $ctTxt.Text = "📝 $($rec.content)"
                $ctTxt.FontSize = 11
                $ctTxt.FontWeight = "Medium"
                $ctTxt.Foreground = Get-Brush "#334155"
                $ctTxt.TextWrapping = "Wrap"
                $ctBorder.Child = $ctTxt
                $metaWrap.Children.Add($ctBorder) | Out-Null
            }
            if ($hasAbsent) {
                $abBorder = New-Object System.Windows.Controls.Border
                $abBorder.Background = Get-Brush "#FEE2E2"
                $abBorder.CornerRadius = New-Object System.Windows.CornerRadius(6)
                $abBorder.Padding = New-Object System.Windows.Thickness(6, 2, 6, 2)
                $abBorder.Margin = New-Object System.Windows.Thickness(0, 0, 4, 2)
                $abTxt = New-Object System.Windows.Controls.TextBlock
                $abTxt.Text = "🙋‍♀️ 결시: $($rec.absent)"
                $abTxt.FontSize = 11
                $abTxt.FontWeight = "Bold"
                $abTxt.Foreground = Get-Brush "#B91C1C"
                $abTxt.TextWrapping = "Wrap"
                $abBorder.Child = $abTxt
                $metaWrap.Children.Add($abBorder) | Out-Null
            }
            if ($hasNote) {
                $ntBorder = New-Object System.Windows.Controls.Border
                $ntBorder.Background = Get-Brush "#FEF3C7"
                $ntBorder.CornerRadius = New-Object System.Windows.CornerRadius(6)
                $ntBorder.Padding = New-Object System.Windows.Thickness(6, 2, 6, 2)
                $ntBorder.Margin = New-Object System.Windows.Thickness(0, 0, 4, 2)
                $ntTxt = New-Object System.Windows.Controls.TextBlock
                $ntTxt.Text = "⭐ 특이: $($rec.note)"
                $ntTxt.FontSize = 11
                $ntTxt.FontWeight = "Bold"
                $ntTxt.Foreground = Get-Brush "#B45309"
                $ntTxt.TextWrapping = "Wrap"
                $ntBorder.Child = $ntTxt
                $metaWrap.Children.Add($ntBorder) | Out-Null
            }
            $cardStack.Children.Add($metaWrap) | Out-Null
        }

        $cardBorder.Child = $cardStack

        # 카드 클릭 시 빠른 수정 팝업 열기
        $cardBorder.Add_MouseLeftButtonUp({
            param($sender, $e)
            if (-not $e.Handled) {
                Open-QuickEditDialog $sender.Tag
            }
        })

        $LessonsContainer.Children.Add($cardBorder) | Out-Null
    }
}

# 버튼 이벤트 연결 (날짜 이동 시 최신 데이터 즉시 재로드 후 렌더링)
$PrevDayBtn.Add_Click({
    $d = $script:CurrentDate
    do { $d = $d.AddDays(-1) } while ($d.DayOfWeek -eq 'Saturday' -or $d.DayOfWeek -eq 'Sunday')
    if ($d -ge $StartDate) {
        $script:CurrentDate = $d
        Load-AppState
        Render-Widget
    }
})

$NextDayBtn.Add_Click({
    $d = $script:CurrentDate
    do { $d = $d.AddDays(1) } while ($d.DayOfWeek -eq 'Saturday' -or $d.DayOfWeek -eq 'Sunday')
    if ($d -le $EndDate) {
        $script:CurrentDate = $d
        Load-AppState
        Render-Widget
    }
})

$GoTodayBtn.Add_Click({
    $script:CurrentDate = Get-DefaultWidgetDate
    Load-AppState
    Render-Widget
})

$PinTopBtn.Add_Click({
    $window.Topmost = -not $window.Topmost
    $PinTopBtn.Background = if ($window.Topmost) { Get-Brush '#4F46E5' } else { Get-Brush '#334155' }
    Save-WidgetPosition
})

$CloseWidgetBtn.Add_Click({
    Save-WidgetPosition
    $window.Close()
})

$OpenCalendarBtn.Add_Click({
    if (Test-Path $HtmlFile) {
        Start-Process $HtmlFile
    }
})

$ToggleHolidayBtn.Add_Click({
    $dateStr = $script:CurrentDate.ToString("yyyy-MM-dd")
    $curHol = Get-PropValue $script:AppState.holidays $dateStr
    if (-not [string]::IsNullOrWhiteSpace($curHol)) {
        $script:AppState.holidays.PSObject.Properties.Remove($dateStr)
    } else {
        Set-PropValue $script:AppState.holidays $dateStr "학교 행사 / 휴일"
    }
    Save-AppState
    Render-Widget
})

# 1초마다 파일 변경 감지하여 전체 달력에서 수정한 내용을 위젯에 즉시 반영
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1.2)
$timer.Add_Tick({
    if (Test-Path $DataFile) {
        $lw = (Get-Item $DataFile).LastWriteTime
        if ($lw -gt $script:LastFileWriteTime) {
            Load-AppState
            Render-Widget
        }
    }
})
$timer.Start()

Load-AppState
Render-Widget
$window.ShowDialog() | Out-Null
