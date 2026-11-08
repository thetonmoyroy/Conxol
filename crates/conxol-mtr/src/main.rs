use conxol_mtr::{Options, run};
use std::sync::atomic::AtomicBool;

fn main() -> std::process::ExitCode {
    match execute() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("conxol-mtr: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn execute() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() == 1 && matches!(args[0].as_str(), "--help" | "-h") {
        println!(
            "conxol-mtr <IPv4> [cycles] [max-hops]\nNative ICMP; emits JSON lines. Defaults: 5 cycles, 30 hops.\nOnly use explicitly authorized destinations. Ctrl+C exits."
        );
        return Ok(());
    }
    if args.is_empty() || args.len() > 3 {
        return Err("usage: conxol-mtr <IPv4> [cycles] [max-hops]".into());
    }
    let mut options = Options::new(args[0].parse()?);
    if let Some(value) = args.get(1) {
        options.cycles = value.parse()?;
    }
    if let Some(value) = args.get(2) {
        options.max_hops = value.parse()?;
    }
    let cancel = AtomicBool::new(false);
    // Complete-cycle JSON lines are bounded to 32 rows each. The library also
    // provides per-probe progress for future desktop integration.
    let mut last_cycle = 0;
    run(&options, &cancel, |report| {
        if report.completed_cycles > last_cycle {
            last_cycle = report.completed_cycles;
            println!(
                "{}",
                serde_json::to_string(report).expect("finite numeric statistics")
            );
        }
    })?;
    Ok(())
}
