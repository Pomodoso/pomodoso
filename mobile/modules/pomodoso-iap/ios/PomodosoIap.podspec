Pod::Spec.new do |s|
  s.name           = 'PomodosoIap'
  s.version        = '1.0.0'
  s.summary        = 'StoreKit 2 purchases, with no third-party billing service.'
  s.description    = 'Fetches products, runs the purchase sheet, and hands JavaScript the signed transaction Apple produced. Grants nothing on its own — the backend verifies the signature.'
  s.author         = 'Pomodoso'
  s.homepage       = 'https://pomodoso.com'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
