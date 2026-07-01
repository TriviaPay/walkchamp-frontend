require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'WalkChampRaceProgress'
  s.version        = package['version']
  s.summary        = 'Walk Champ race progress and step tracking native module'
  s.description    = 'Foreground service (Android) and Live Activity (iOS) for Walk Champ.'
  s.license        = 'UNLICENSED'
  s.author         = 'Walk Champ'
  s.homepage       = 'https://walkchamp.app'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
  s.exclude_files = 'WidgetExtension/**/*', 'Widget/**/*'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
