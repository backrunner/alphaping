fn main() -> Result<(), Box<dyn std::error::Error>> {
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    unsafe {
        std::env::set_var("PROTOC", protoc);
    }
    let proto = "../../proto/alphaping/v1/agent.proto";
    println!("cargo:rerun-if-changed={proto}");
    prost_build::Config::new().compile_protos(&[proto], &["../../proto"])?;
    Ok(())
}
