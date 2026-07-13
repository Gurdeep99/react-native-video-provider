require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "AuVideo"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/grdp99/react-native-au-video.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"
  s.private_header_files = "ios/**/*.h"

  s.frameworks = "AVFoundation", "AVKit"
  s.swift_version = "5.9"
  # Swift core + ObjC++ glue in one pod: the glue imports the generated
  # <AuVideo/AuVideo-Swift.h>, which requires the pod to define a module.
  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
  }

  install_modules_dependencies(s)
end
