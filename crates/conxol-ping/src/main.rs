use conxol_ping::{Options, run};
use std::sync::atomic::AtomicBool;

fn main() -> std::process::ExitCode {
    match execute() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("conxol-ping: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
fn execute() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() == 1 && matches!(args[0].as_str(), "--help" | "-h") {
        println!(
            "conxol-ping <IPv4> [count] [payload-bytes]\nNative ICMP; JSON line per probe. Defaults: 5 probes, 32 payload bytes.\nCtrl+C exits."
        );
        return Ok(());
    }
    if args.is_empty() || args.len() > 3 {
        return Err("usage: conxol-ping <IPv4> [count] [payload-bytes]".into());
    }
    let mut options = Options::new(args[0].parse()?);
    if let Some(value) = args.get(1) {
        options.count = value.parse()?;
    }
    if let Some(value) = args.get(2) {
        options.payload_size = value.parse()?;
    }
    run(&options, &AtomicBool::new(false), |report| {
        println!(
            "{}",
            serde_json::to_string(report).expect("finite numeric statistics")
        );
    })?;
    Ok(())
}
